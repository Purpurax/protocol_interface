// Seed "database" for the built-in simulator. Table and column names follow the warehouse
// migrations; the conveyor / pipetter layout is the one from protocol_warehouse/seeds/setup.sql
// plus two storage shelves, more cargo and a few protocols to play with.

import { COLLECTIONS, collectionSlots } from '../shared/collections.js';

const EPOCH = new Date(0).toISOString();

export function seedDatabase() {
  const db = {
    motor: [], conveyor: [], deadzone: [], calibrator: [], pipetter: [], cargo: [], container_type: [],
    container: [], tip_container: [], substance: [], protein: [], organism: [], material: [],
    protocol: [], instruction: [], run: null,
    seq: { instruction: 0, automatic: 0, manual: 0, run: 0 },
  };
  const next = (table, key) => db[table].reduce((max, row) => Math.max(max, row[key]), 0) + 1;

  const motor = (grbl_index, axis, requires_homing = false) => {
    const row = { motor_id: next('motor', 'motor_id'), grbl_index, axis, grbl_value: 0, last_home: EPOCH, requires_homing };
    db.motor.push(row);
    return row.motor_id;
  };
  const conveyor = (is_storage, absolute_x, absolute_y, x_motor, y_motor, length_x, length_y = 0) => {
    const row = { conveyor_id: next('conveyor', 'conveyor_id'), is_storage, absolute_x, absolute_y, x_motor, y_motor, length_x, length_y };
    db.conveyor.push(row);
    return row.conveyor_id;
  };

  // --- Conveyors (same geometry as the warehouse seed) ---
  const bottom = conveyor(false, 167, 122, motor(1, 'X'), null, 588);
  const above = conveyor(false, 167, 282, motor(2, 'X'), null, 588);
  const elevator = conveyor(false, 12, 89, motor(2, 'Z'), motor(2, 'Y', true), 137, 1378);
  const pipetterBelt = conveyor(false, 167, 967, motor(3, 'Z'), null, 1375);
  const storageA = conveyor(true, 167, 442, motor(4, 'X'), null, 588);
  const storageB = conveyor(true, 167, 602, motor(4, 'Y'), null, 588);

  db.pipetter.push({
    pipetter_id: 1, on_conveyor_id: pipetterBelt, absolute_x: 961, absolute_y: 1005,
    y_motor: motor(3, 'Y', true), z_motor: motor(3, 'X', true), push_motor: motor(5, 'X'), length_y: 220, length_z: 120,
  });
  db.deadzone.push({ deadzone_id: 1, on_conveyor_id: pipetterBelt, start_x: 420, end_x: 470 });
  db.calibrator.push(
    { calibrator_id: 1, conveyor_id: pipetterBelt, meant_for_cargo: true, calibrates_left_x: 0, calibrates_right_x: null, calibrates_up_y: null, calibrates_down_y: null },
    { calibrator_id: 2, conveyor_id: elevator, meant_for_cargo: false, calibrates_left_x: null, calibrates_right_x: null, calibrates_up_y: null, calibrates_down_y: 0 },
  );

  // --- Substances ---
  const hazard = (flags = '') => ({
    flammable: flags.includes('F'), corrosive: flags.includes('C'), toxic: flags.includes('T'),
    environmental: flags.includes('E'), oxidizer: flags.includes('O'),
  });
  const substance = (substance_name, cas_number, formula, molar, density, flags) => {
    const row = { substance_id: next('substance', 'substance_id'), cas_number, substance_name, formula, hazard: hazard(flags), molar, density };
    db.substance.push(row);
    return row.substance_id;
  };
  const S = {
    water: substance('Water', '7732-18-5', 'H2O', 18.01528, 1.0),
    nacl: substance('Sodium chloride', '7647-14-5', 'NaCl', 58.44, 2.16),
    glucose: substance('D-Glucose', '50-99-7', 'C6H12O6', 180.156, 1.54),
    ethanol: substance('Ethanol', '64-17-5', 'C2H6O', 46.069, 0.789, 'F'),
    hcl: substance('Hydrochloric acid', '7647-01-0', 'HCl', 36.46, 1.18, 'CT'),
    tris: substance('Tris', '77-86-1', 'C4H11NO3', 121.14, 1.33),
    peroxide: substance('Hydrogen peroxide', '7722-84-1', 'H2O2', 34.014, 1.45, 'OC'),
    copper: substance('Copper(II) sulfate', '7758-98-7', 'CuSO4', 159.609, 3.6, 'TE'),
    ampicillin: substance('Ampicillin', '69-53-4', 'C16H19N3O4S', 349.41, 1.45, 'T'),
  };
  db.organism.push({ organism_id: 1, organism_name: 'E. coli DH5α' }, { organism_id: 2, organism_name: 'S. cerevisiae' });

  // --- Materials ---
  const sub = (id) => db.substance.find((s) => s.substance_id === id);
  /** `ul` of water with solutes given as mol/L, liquids as volume fraction {ethanol: '70%'}. */
  const mix = (ul, solutes = {}, organisms = {}) => {
    const substances = [];
    let waterUl = ul;
    for (const [key, amount] of Object.entries(solutes)) {
      const s = sub(S[key]);
      if (typeof amount === 'string') {
        const part = (parseFloat(amount) / 100) * ul;
        waterUl -= part;
        substances.push({ substance_id: s.substance_id, amount: ((part / 1000) * s.density) / s.molar });
      } else {
        substances.push({ substance_id: s.substance_id, amount: amount * (ul / 1e6) });
      }
    }
    if (waterUl > 0) substances.unshift({ substance_id: S.water, amount: ((waterUl / 1000) * 1.0) / 18.01528 });
    return {
      substances, proteins: [],
      organisms: Object.entries(organisms).map(([id, amount]) => ({ organism_id: Number(id), amount })),
    };
  };
  const material = (content) => {
    const row = { material_id: next('material', 'material_id'), ...(content || { substances: [], proteins: [], organisms: [] }) };
    db.material.push(row);
    return row.material_id;
  };

  // --- Cargo ---
  const typeId = (name) => {
    let row = db.container_type.find((t) => t.container_type_name === name);
    if (!row) {
      row = { container_type_id: next('container_type', 'container_type_id'), container_type_name: name };
      db.container_type.push(row);
    }
    return row.container_type_id;
  };
  /** contents: { A1: material | [material, closed] } */
  const cargo = (label, collection, on_conveyor_id, relative_x, anchored, contents = {}) => {
    const spec = COLLECTIONS[collection];
    const cargo_id = next('cargo', 'cargo_id');
    db.cargo.push({
      cargo_id, relative_x, anchored_conveyor: anchored ? on_conveyor_id : null,
      anchored_relative_x: anchored ? relative_x : null, on_conveyor_id,
      x_distance_after_last_calibration: Math.round(relative_x * 1.7), is_available: true, label, collection,
    });
    const ids = {};
    for (const slot of collectionSlots(spec)) {
      if (spec.isTips) {
        db.tip_container.push({
          tip_container_id: next('tip_container', 'tip_container_id'), on_cargo_id: cargo_id,
          relative_center_x: slot.x, relative_center_z: slot.z, has_tip: true, is_sterile: true,
        });
        continue;
      }
      const entry = contents[slot.name];
      const [content, closed] = Array.isArray(entry) ? entry : [entry, false];
      const container_id = next('container', 'container_id');
      db.container.push({
        container_id, container_type_id: typeId(spec.type), on_cargo_id: cargo_id, relative_center_x: slot.x,
        relative_center_z: slot.z, maximum_volume: spec.maxVolume, is_closed: !!closed, material_id: material(content),
      });
      ids[slot.name] = container_id;
    }
    return ids;
  };

  const reagents = cargo('Reagents', 'falcon50', bottom, 0, false, {
    A1: mix(42000), A2: mix(30000, { nacl: 1 }), A3: mix(25000, { glucose: 0.5 }),
    B1: mix(38000), B2: mix(20000, { tris: 0.1 }), B3: [mix(35000, { ethanol: '70%' }), true],
  });
  const buffers = cargo('Buffers', 'falcon15', bottom, 140, false, {
    A1: mix(12000), A2: mix(9000, { nacl: 0.15 }), A3: mix(6000, { hcl: 1 }), A4: mix(8000, { copper: 0.05 }), A5: null,
    B1: mix(10000, { glucose: 0.1 }), B2: null, B3: mix(4000, { peroxide: 0.9 }), B4: null, B5: mix(7000, { ampicillin: 0.0003 }),
    C1: null, C2: mix(5000, { tris: 0.05, nacl: 0.15 }), C3: null, C4: null, C5: mix(3000, { glucose: 0.02 }, { 1: 2e9 }),
  });
  const plateContent = {};
  for (const [well, content] of [['A1', mix(150)], ['A2', mix(150, { nacl: 0.15 })], ['A3', mix(120, { glucose: 0.1 })], ['B1', mix(200, { copper: 0.05 })], ['B2', mix(90, { glucose: 0.02 }, { 1: 5e7 })]]) plateContent[well] = content;
  const plate = cargo('Assay plate', 'wells96', bottom, 280, false, plateContent);
  cargo('Tips', 'tips', above, 0, false);
  const culture = cargo('Culture plate', 'wells24', above, 140, false, {
    A1: mix(1500, { glucose: 0.02 }, { 1: 8e8 }), A2: mix(1500, { glucose: 0.02 }, { 1: 6e8 }), A3: mix(1500, { glucose: 0.02 }),
    B1: mix(1200, { glucose: 0.02, ampicillin: 0.0003 }, { 1: 1e8 }),
  });
  const stock = cargo('Stock', 'falcon50', storageA, 0, true, {
    A1: [mix(48000), true], A2: [mix(45000, { nacl: 1 }), true], A3: [mix(40000, { ethanol: '70%' }), true],
    B1: [mix(30000, { hcl: 1 }), true], B2: mix(22000, { glucose: 0.5 }), B3: null,
  });
  cargo('Tips (spare)', 'tips', storageA, 140, true);
  cargo('Agar', 'petri', storageB, 0, true, { A1: mix(18000, { glucose: 0.02, nacl: 0.17 }, { 1: 3e6 }) });

  // --- Protocols ---
  const containerMaterial = (container_id) => {
    const c = db.container.find((row) => row.container_id === container_id);
    const m = db.material.find((row) => row.material_id === c.material_id);
    return JSON.parse(JSON.stringify({ substances: m.substances, proteins: m.proteins, organisms: m.organisms }));
  };
  const protocol = (protocol_name, protocol_author, protocol_version, steps, bound = true) => {
    const physical = [...new Set(steps.flatMap(([from, to]) => [from, to]))];
    db.protocol.push({
      protocol_id: next('protocol', 'protocol_id'), protocol_name, protocol_author, protocol_version,
      protocol_software_version: '0.0.1',
      containers: physical.map((container_id, virtual_container_id) => ({
        virtual_container_id, material: containerMaterial(container_id), internal_temperature: 20,
        homogeneous: true, last_update: EPOCH, preferred_container_id: bound ? container_id : null,
      })),
      steps: steps.map(([from, to, volume], step_order) => ({
        step_order, kind: 'transfer', from_id: physical.indexOf(from), to_id: physical.indexOf(to), volume,
      })),
    });
  };
  protocol('Test protocol', 'me', '0.0.1', [[reagents.A1, reagents.B1, 1000], [reagents.B1, reagents.A1, 1000]], false);
  protocol('Saline dilution row', 'me', '0.2.0', [
    [reagents.A1, plate.C1, 180], [reagents.A2, plate.C1, 20],
    [reagents.A1, plate.C2, 190], [reagents.A2, plate.C2, 10],
  ]);
  protocol('Glucose feed', 'me', '1.0.0', [[reagents.A3, culture.A1, 250], [reagents.A3, culture.A2, 250], [reagents.A3, culture.B1, 150]]);
  protocol('Acid quench', 'lab', '0.1.3', [[stock.B1, buffers.B2, 800], [buffers.A1, buffers.B2, 2400]]);
  protocol('Ethanol wash', 'lab', '0.3.1', [[reagents.B3, buffers.C1, 900], [reagents.B1, buffers.C1, 600], [buffers.C1, buffers.C3, 700]]);

  return db;
}
