// Warehouse API client. One code path for both backends: the transport is either HTTP (the real
// warehouse, or `serve.mjs --mock`) or the in-browser simulator.

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Talks to the warehouse over HTTP + SSE. */
export class HttpTransport {
  constructor(baseUrl) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.kind = 'http';
  }

  async request(method, path, query, body, { timeout = 8000 } = {}) {
    const search = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetch(`${this.base}${path}${search}`, {
        method, signal: controller.signal, cache: 'no-store',
        headers: body != null ? { 'content-type': 'application/json' } : undefined,
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ApiError(0, err.name === 'AbortError' ? 'Warehouse did not answer in time' : 'Warehouse not reachable');
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new ApiError(response.status, data?.error || text || `HTTP ${response.status}`);
    // The current warehouse builds some answers by hand; a failed run is not valid JSON but names an error.
    if (data == null && /"error"\s*:/.test(text)) throw new ApiError(response.status, text.replace(/^.*"error"\s*:\s*/s, '').replace(/\}\s*$/, '') || 'Request failed');
    // The current warehouse answers 200 with {"error": ...} for a failed run.
    if (data && typeof data === 'object' && 'error' in data && data.error) throw new ApiError(response.status, String(data.error));
    return data;
  }

  /** Server-sent events; the browser reconnects on its own. Returns a function that closes the stream. */
  listen(onEvent, onState) {
    const source = new EventSource(`${this.base}/listen`);
    source.onmessage = (message) => {
      try { onEvent(JSON.parse(message.data)); } catch { /* not JSON: ignore */ }
    };
    source.onopen = () => onState?.(true);
    source.onerror = () => onState?.(false);
    return () => source.close();
  }
}

/** Calls the simulator in the same page. */
export class SimTransport {
  constructor(sim) {
    this.sim = sim;
    this.kind = 'sim';
  }

  async request(method, path, query, body) {
    const result = await this.sim.handle(method, path, query || {}, body == null ? null : JSON.parse(JSON.stringify(body)));
    if (result.status >= 400) throw new ApiError(result.status, result.json?.error || `HTTP ${result.status}`);
    return result.json;
  }

  listen(onEvent, onState) {
    onState?.(true);
    return this.sim.subscribe((event) => onEvent(JSON.parse(JSON.stringify(event))));
  }
}

export class Api {
  constructor(transport) { this.transport = transport; }
  get simulated() { return this.transport.kind === 'sim'; }

  get(path, query) { return this.transport.request('GET', path, query, null); }
  post(path, body) { return this.transport.request('POST', path, null, body ?? {}); }
  put(path, body) { return this.transport.request('PUT', path, null, body); }
  del(path) { return this.transport.request('DELETE', path, null, null); }
  listen(onEvent, onState) { return this.transport.listen(onEvent, onState); }

  status() { return this.get('/status'); }
  state() { return this.get('/warehouse/state'); }

  protocols() { return this.get('/protocols'); }
  protocol(id) { return this.get(`/protocol/${id}`); }
  createProtocol(body) { return this.post('/protocol', body); }
  updateProtocol(id, body) { return this.put(`/protocol/${id}`, body); }
  deleteProtocol(id) { return this.del(`/protocol/${id}`); }
  canRun(id) { return this.get('/protocol/can_run', { id }); }
  plan(id) { return this.get('/protocol/plan', { id }); }
  run(id) { return this.get('/protocol/run', { id }); }
  abort() { return this.post('/protocol/abort'); }

  /** No new instruction is started while paused; running moves finish. */
  pause() { return this.post('/runtime/pause'); }
  resume() { return this.post('/runtime/resume'); }
  /** One manual move of a conveyor's belt (axis 'x') or lift (axis 'y'), in mm. */
  moveConveyor(id, axis, distance) { return this.post(`/conveyor/${id}/move`, { axis, distance }); }
  /** Declares where a cargo stands (nothing moves). body: { on_conveyor_id, relative_x } */
  setCargoPosition(id, body) { return this.post(`/cargo/${id}/position`, body); }
  /** Lets the warehouse drive a cargo to a position. body: { on_conveyor_id, relative_x } */
  navigateCargo(id, body) { return this.post(`/cargo/${id}/navigate`, body); }

  acceptManual(id) { return this.post(`/instruction/manual/accept/${id}`); }
  completeManual(id) { return this.post(`/instruction/manual/complete/${id}`); }

  removeCargo(id) { return this.post(`/cargo/${id}/remove`); }
  insertCargo(id, body) { return this.post(`/cargo/${id}/insert`, body); }
  createCargo(body) { return this.post('/cargo', body); }
  deleteCargo(id) { return this.del(`/cargo/${id}`); }
}

/** Where the warehouse API lives: explicit setting, the dev-server proxy, or the default port. */
export async function resolveBaseUrl(configured) {
  if (configured) return configured;
  try {
    const response = await fetch('/__interface', { cache: 'no-store' });
    if (response.ok && (await response.json()).proxy) return `${location.origin}/api`;
  } catch { /* not served by serve.mjs */ }
  return `http://${location.hostname || 'localhost'}:3210`;
}
