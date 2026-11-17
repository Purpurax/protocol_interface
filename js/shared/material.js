// Material math shared by the interface, the predictor and the built-in simulator.
// Mirrors protocol_lib: amounts are mol, molar is g/mol, density is g/mL, volumes are µL.

export const HAZARD_KEYS = ['flammable', 'corrosive', 'toxic', 'environmental', 'oxidizer'];

export const num = (v, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

export const emptyMaterial = () => ({ substances: [], proteins: [], organisms: [] });

export const cloneMaterial = (m) => ({
  substances: (m?.substances || []).map((s) => ({ substance_id: s.substance_id, amount: num(s.amount) })),
  proteins: (m?.proteins || []).map((s) => ({ protein_id: s.protein_id, amount: num(s.amount) })),
  organisms: (m?.organisms || []).map((s) => ({ organism_id: s.organism_id, amount: num(s.amount) })),
});

export const isEmptyMaterial = (m) =>
  !m || (!m.substances?.length && !m.proteins?.length && !m.organisms?.length);

const massOf = (entry, lookup) => num(entry.amount) * num(lookup.substances.get(entry.substance_id)?.molar);

/** The substance that defines the volume: the heaviest one that has a density. */
export function solventOf(mat, lookup) {
  let best = null, bestMass = -1;
  for (const e of mat?.substances || []) {
    const s = lookup.substances.get(e.substance_id);
    if (!s || !num(s.density) || !num(s.molar)) continue;
    const mass = massOf(e, lookup);
    if (mass > bestMass) { best = e; bestMass = mass; }
  }
  return best;
}

/** Estimated volume in µL (same idea as Material::estimate_total_volume in protocol_lib). */
export function materialVolume(mat, lookup) {
  const solvent = solventOf(mat, lookup);
  if (!solvent) return 0;
  const s = lookup.substances.get(solvent.substance_id);
  return (massOf(solvent, lookup) / num(s.density)) * 1000;
}

/** Splits `ratio` (0..1) of everything out of `mat` (mutates it) and returns the extracted part. */
export function extractRatio(mat, ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  const out = emptyMaterial();
  for (const [list, key] of [['substances', 'substance_id'], ['proteins', 'protein_id'], ['organisms', 'organism_id']]) {
    for (const e of mat[list] || []) {
      const take = num(e.amount) * r;
      e.amount = num(e.amount) - take;
      if (take > 0) out[list].push({ [key]: e[key], amount: take });
    }
    mat[list] = (mat[list] || []).filter((e) => e.amount > 1e-15);
  }
  return out;
}

/** Adds `add` into `mat` (mutates `mat`). */
export function mergeMaterial(mat, add) {
  for (const [list, key] of [['substances', 'substance_id'], ['proteins', 'protein_id'], ['organisms', 'organism_id']]) {
    mat[list] = mat[list] || [];
    for (const e of add[list] || []) {
      const hit = mat[list].find((x) => x[key] === e[key]);
      if (hit) hit.amount = num(hit.amount) + num(e.amount);
      else mat[list].push({ [key]: e[key], amount: num(e.amount) });
    }
  }
  return mat;
}

/** Concentration based comparison with a tolerance in percent (Material::eq in protocol_lib). */
export function materialsMatch(a, b, lookup, tolerancePercent = 5) {
  for (const list of ['substances', 'proteins', 'organisms']) {
    if ((a?.[list]?.length || 0) !== (b?.[list]?.length || 0)) return false;
  }
  let va = materialVolume(a, lookup), vb = materialVolume(b, lookup);
  if ((va === 0) !== (vb === 0)) return false;
  if (va === 0) { va = 1; vb = 1; }
  const tol = tolerancePercent / 100;
  for (const [list, key] of [['substances', 'substance_id'], ['proteins', 'protein_id'], ['organisms', 'organism_id']]) {
    for (const e of a?.[list] || []) {
      const o = b[list].find((x) => x[key] === e[key]);
      if (!o) return false;
      const ca = num(e.amount) / va, cb = num(o.amount) / vb;
      if (Math.abs(ca - cb) > Math.abs(cb) * tol) return false;
    }
  }
  return true;
}

/** Structured component list for display. */
export function materialComponents(mat, lookup) {
  const volume = materialVolume(mat, lookup);
  const solvent = solventOf(mat, lookup);
  const liters = volume / 1e6;
  const out = [];
  const own = (e) => {
    const s = lookup.substances.get(e.substance_id) || {};
    return num(s.density) ? (massOf(e, lookup) / num(s.density)) * 1000 : 0;
  };
  const ownTotal = (mat?.substances || []).reduce((sum, e) => sum + own(e), 0);
  for (const e of mat?.substances || []) {
    const s = lookup.substances.get(e.substance_id) || {};
    const isSolvent = e === solvent;
    const ownVolume = own(e);
    out.push({
      kind: 'substance', id: e.substance_id, name: s.substance_name || `Substance ${e.substance_id}`,
      formula: s.formula || '', cas: s.cas_number || '', mol: num(e.amount), mass: massOf(e, lookup),
      isSolvent, molarity: liters > 0 ? num(e.amount) / liters : 0,
      volumeFraction: ownTotal > 0 ? ownVolume / ownTotal : 0, hazard: s.hazard || {},
    });
  }
  for (const e of mat?.organisms || []) {
    const o = lookup.organisms.get(e.organism_id) || {};
    out.push({ kind: 'organism', id: e.organism_id, name: o.organism_name || `Organism ${e.organism_id}`, amount: num(e.amount) });
  }
  for (const e of mat?.proteins || []) {
    out.push({ kind: 'protein', id: e.protein_id, name: `Protein ${e.protein_id}`, amount: num(e.amount) });
  }
  out.sort((a, b) => (b.isSolvent ? 1 : 0) - (a.isSolvent ? 1 : 0) || (b.mass || 0) - (a.mass || 0));
  return out;
}

export function fmtVolume(ul) {
  const v = num(ul);
  if (Math.abs(v) >= 1000) return `${trim(v / 1000)} mL`;
  if (Math.abs(v) >= 1 || v === 0) return `${trim(v)} µL`;
  return `${trim(v * 1000)} nL`;
}

export function fmtMolarity(m) {
  if (!(m > 0)) return '0 M';
  if (m >= 1) return `${trim(m)} M`;
  if (m >= 1e-3) return `${trim(m * 1e3)} mM`;
  if (m >= 1e-6) return `${trim(m * 1e6)} µM`;
  return `${trim(m * 1e9)} nM`;
}

function trim(v) {
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** How one component should be written: solvent as volume, liquids as % v/v, solutes as molarity. */
export function componentAmount(c, totalVolume) {
  if (c.kind === 'organism') return c.amount >= 1e4 ? `${c.amount.toExponential(1)} cells` : `${Math.round(c.amount)} cells`;
  if (c.kind === 'protein') return `${Math.round(c.amount)}`;
  if (c.isSolvent) return fmtVolume(totalVolume);
  if (c.volumeFraction >= 0.15) return `${trim(c.volumeFraction * 100)} % v/v`; // a second liquid, not a solute
  return fmtMolarity(c.molarity);
}

/** Short human name, e.g. "NaCl 1 M in Water" or "Water". */
export function materialLabel(mat, lookup) {
  if (isEmptyMaterial(mat)) return 'Empty';
  const comps = materialComponents(mat, lookup);
  const volume = materialVolume(mat, lookup);
  const solvent = comps.find((c) => c.isSolvent);
  const rest = comps.filter((c) => !c.isSolvent);
  if (!rest.length) return solvent ? solvent.name : 'Unknown';
  const short = (c) => (c.kind === 'substance' ? `${c.formula && c.formula.length <= 6 ? c.formula : c.name} ${componentAmount(c, volume)}` : c.name);
  const head = rest.slice(0, 2).map(short).join(' + ') + (rest.length > 2 ? ` +${rest.length - 2}` : '');
  return solvent ? `${head} in ${solvent.name}` : head;
}

/** Identity of the *kind* of material (ignores the amount) for quick-select grouping. */
export function materialSignature(mat, lookup) {
  if (isEmptyMaterial(mat)) return 'empty';
  const volume = materialVolume(mat, lookup) || 1;
  const bucket = (c) => Math.round(Math.log(Math.max(c, 1e-30)) / Math.log(1.1));
  const parts = [];
  for (const e of mat.substances || []) parts.push(`s${e.substance_id}:${bucket(num(e.amount) / volume)}`);
  for (const e of mat.proteins || []) parts.push(`p${e.protein_id}:${bucket(num(e.amount) / volume)}`);
  for (const e of mat.organisms || []) parts.push(`o${e.organism_id}`);
  return parts.sort().join('|');
}

/** Union of the hazard flags of every substance in the material. */
export function materialHazards(mat, lookup) {
  const flags = [];
  for (const key of HAZARD_KEYS) {
    if ((mat?.substances || []).some((e) => lookup.substances.get(e.substance_id)?.hazard?.[key])) flags.push(key);
  }
  if ((mat?.organisms || []).length) flags.push('biological');
  return flags;
}

/** Deterministic display colour (hue 0..360, saturation, lightness) for a liquid. */
export function materialTint(mat, lookup) {
  if (isEmptyMaterial(mat)) return null;
  const comps = materialComponents(mat, lookup).filter((c) => !c.isSolvent);
  if (!comps.length) return { h: 196, s: 70, l: 62 };
  const lead = comps[0];
  let hash = 0;
  for (const ch of `${lead.kind}${lead.name}`) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { h: hash % 360, s: lead.kind === 'organism' ? 55 : 78, l: 58 };
}
