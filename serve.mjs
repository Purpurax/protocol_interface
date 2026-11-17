#!/usr/bin/env node
// Zero-dependency dev server for the warehouse interface.
//
//   node serve.mjs                 serve on :8080, proxy /api/* to the warehouse on 127.0.0.1:3210
//   node serve.mjs --port 9000     another port
//   node serve.mjs --warehouse http://192.168.0.6:3210
//   node serve.mjs --mock          answer /api/* with the built-in simulator instead of the warehouse
//
// The proxy exists so the browser talks to one origin (the warehouse sends no CORS headers).
// /__models lists the STL files in ./models for the prefab workshop.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(option('port', process.env.PORT || 8080));
const host = option('host', '127.0.0.1');
const warehouse = new URL(option('warehouse', process.env.WAREHOUSE_URL || 'http://127.0.0.1:3210'));
const mock = args.includes('--mock');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.stl': 'model/stl', '.md': 'text/markdown; charset=utf-8',
};

let sim = null;
if (mock) {
  const { WarehouseSim } = await import('./js/sim/warehouse-sim.js');
  sim = new WarehouseSim();
  sim.start();
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks)));
});

async function mockApi(req, res, url) {
  const apiPath = url.pathname.slice('/api'.length) || '/';
  if (apiPath === '/listen') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    const unsubscribe = sim.subscribe((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    req.on('close', () => { unsubscribe(); clearInterval(keepAlive); });
    return;
  }
  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const raw = (await readBody(req)).toString('utf8');
    try { body = raw ? JSON.parse(raw) : null; } catch { return json(res, 400, { error: 'Body is not valid JSON' }); }
  }
  const result = await sim.handle(req.method, apiPath, Object.fromEntries(url.searchParams), body);
  json(res, result.status, result.json);
}

function proxyApi(req, res, url) {
  const upstream = http.request({
    hostname: warehouse.hostname, port: warehouse.port || 80, method: req.method,
    path: (url.pathname.slice('/api'.length) || '/') + url.search,
    headers: { ...req.headers, host: warehouse.host },
  }, (answer) => {
    res.writeHead(answer.statusCode || 502, { ...answer.headers, 'cache-control': 'no-store' });
    answer.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) json(res, 502, { error: `Warehouse not reachable at ${warehouse.origin}` });
    else res.end();
  });
  // `res` closes when the answer is complete or the browser goes away (e.g. an SSE stream);
  // `req` already closes once its body is read, which would cut every request short.
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

function listModels(res) {
  const dir = path.join(root, 'models');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.stl')).sort()
      .map((name) => ({ name, url: `models/${encodeURIComponent(name)}`, size: fs.statSync(path.join(dir, name)).size }));
  } catch { /* no models folder */ }
  json(res, 200, files);
}

function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(root, pathname));
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some((part) => part.startsWith('.'))) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size, 'cache-control': 'no-cache',
    });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/__interface') return json(res, 200, { proxy: true, mock, warehouse: mock ? null : warehouse.origin });
  if (url.pathname === '/__models') return listModels(res);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return mock ? mockApi(req, res, url).catch((err) => json(res, 500, { error: String(err) })) : proxyApi(req, res, url);
  }
  return serveStatic(req, res, url);
}).listen(port, host, () => {
  console.log(`Warehouse interface  http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(mock ? 'API: built-in simulator (--mock)' : `API: proxying /api/* to ${warehouse.origin}`);
});
