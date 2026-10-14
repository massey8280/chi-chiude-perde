'use strict';
// Chi chiude perde: tiny room relay + static site.
// - Serves the game from WWW (index.html, fonts, icons).
// - WebSocket on /ws: phones join a room by code; the room keeps the latest game state
//   with a version number. A write is accepted only if it is exactly the next version
//   (compare-and-set), so two phones can never overwrite each other.
// - Everything lives in memory. Nothing is logged except counts.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = +(process.env.PORT || 8080);
const WWW = path.resolve(process.env.WWW || path.join(__dirname, 'www'));
const MAX_STATE = 96 * 1024;        // bytes of one game state
const MAX_ROOMS = 2000;
const MAX_MEMBERS = 12;              // phones in one room
const ROOM_IDLE_MS = 12 * 3600e3;    // forget empty rooms after 12 h
const RATE = { tokens: 40, perMs: 5000 };

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400).end(); return; }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, sockets: wss.clients.size }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400).end(); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(WWW, p));
  if (!file.startsWith(WWW + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Non trovato'); return; }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'content-type': TYPES[ext] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': ext === '.html' || ext === '.webmanifest' ? 'no-cache' : 'public, max-age=604800',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});

// ---------------------------------------------------------------- rooms
// room = { code, v, state, members: Map(id -> { name, sockets:Set, joined }), touched }
const rooms = new Map();
const CODE_RE = /^[A-Z0-9]{4,8}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 16);

function getRoom(code, create) {
  let r = rooms.get(code);
  if (!r && create) {
    if (rooms.size >= MAX_ROOMS) return null;
    r = { code, v: 0, state: null, members: new Map(), touched: Date.now() };
    rooms.set(code, r);
  }
  return r;
}
function membersOf(r) {
  return [...r.members.entries()]
    .sort((a, b) => a[1].joined - b[1].joined)
    .map(([id, m]) => ({ id, name: m.name, online: m.sockets.size > 0 }));
}
function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(r, obj, except) {
  const text = JSON.stringify(obj);
  for (const m of r.members.values()) for (const ws of m.sockets) if (ws !== except && ws.readyState === 1) ws.send(text);
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_STATE + 4096 });

wss.on('connection', ws => {
  ws.alive = true;
  ws.bucket = { n: RATE.tokens, t: Date.now() };
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    // simple token bucket per connection
    const now = Date.now(), b = ws.bucket;
    b.n = Math.min(RATE.tokens, b.n + ((now - b.t) / RATE.perMs) * RATE.tokens); b.t = now;
    if (b.n < 1) { send(ws, { t: 'error', code: 'slow_down' }); return; }
    b.n -= 1;
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    handle(ws, msg);
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

function handle(ws, msg) {
  if (msg.t === 'ping') { send(ws, { t: 'pong' }); return; }
  if (msg.t === 'hello') {
    const code = String(msg.room || '').toUpperCase();
    const id = String(msg.id || '');
    if (!CODE_RE.test(code) || !ID_RE.test(id)) { send(ws, { t: 'error', code: 'bad_hello' }); return; }
    if (ws.room) leave(ws);
    if (msg.fresh && rooms.has(code)) { send(ws, { t: 'error', code: 'taken' }); return; }
    const r = getRoom(code, !!msg.create || rooms.has(code));
    if (!r) { send(ws, { t: 'error', code: msg.create ? 'full' : 'no_room' }); return; }
    let m = r.members.get(id);
    if (!m) {
      if (r.members.size >= MAX_MEMBERS) { send(ws, { t: 'error', code: 'room_full' }); return; }
      m = { name: cleanName(msg.name) || 'Giocatore', sockets: new Set(), joined: Date.now() };
      r.members.set(id, m);
    } else if (msg.name) m.name = cleanName(msg.name) || m.name;
    m.sockets.add(ws);
    ws.room = r; ws.id = id;
    r.touched = Date.now();
    send(ws, { t: 'welcome', room: code, v: r.v, state: r.state, members: membersOf(r) });
    broadcast(r, { t: 'members', members: membersOf(r) }, ws);
    return;
  }
  const r = ws.room;
  if (!r) return;
  r.touched = Date.now();
  if (msg.t === 'name') {
    const m = r.members.get(ws.id);
    if (m) { m.name = cleanName(msg.name) || m.name; broadcast(r, { t: 'members', members: membersOf(r) }); }
    return;
  }
  if (msg.t === 'state') {
    const v = msg.v;
    if (!Number.isInteger(v) || typeof msg.state !== 'object' || msg.state === null) return;
    const text = JSON.stringify(msg.state);
    if (text.length > MAX_STATE) { send(ws, { t: 'error', code: 'too_big' }); return; }
    if (v !== r.v + 1) { send(ws, { t: 'reject', v: r.v, state: r.state }); return; }
    r.v = v; r.state = msg.state;
    send(ws, { t: 'ack', v });
    broadcast(r, { t: 'state', v, state: r.state, by: ws.id }, ws);
    return;
  }
  if (msg.t === 'bye') {
    // leaving the room for good (not just a dropped connection)
    const m = r.members.get(ws.id);
    if (m) { m.sockets.delete(ws); if (!m.sockets.size) r.members.delete(ws.id); }
    ws.room = null;
    broadcast(r, { t: 'members', members: membersOf(r) });
  }
}

function leave(ws) {
  const r = ws.room;
  if (!r) return;
  ws.room = null;
  const m = r.members.get(ws.id);
  if (m) m.sockets.delete(ws);
  r.touched = Date.now();
  broadcast(r, { t: 'members', members: membersOf(r) });
}

// heartbeat: drop dead sockets so "offline" shows up quickly
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 20000).unref();

// forget rooms nobody has used for a while
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const online = [...r.members.values()].some(m => m.sockets.size);
    if (!online && now - r.touched > ROOM_IDLE_MS) rooms.delete(code);
  }
}, 600000).unref();

server.listen(PORT, () => console.log(`chi-chiude-perde relay on :${PORT}, www=${WWW}`));
const stop = () => { server.close(); for (const ws of wss.clients) ws.close(1001); setTimeout(() => process.exit(0), 300).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
