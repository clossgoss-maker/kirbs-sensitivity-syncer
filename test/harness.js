'use strict';
// Runs the real UI in a normal browser against a fake game install, for testing without Electron.
//   node test/harness.js  ->  http://localhost:5178
const http = require('http');
const fs = require('fs');
const path = require('path');
const L = require('../core/locate');
const { makeHandlers } = require('../app/handlers');
const { fakeMachine } = require('./fixtures');

const m = fakeMachine();
const handlers = makeHandlers(m.st, () => L.makeContext({ env: m.env, platform: 'linux' }), {
  chooseFile: () => path.join(m.home, 'AppData/Local/Discovery/Saved/Config/WindowsClient/GameUserSettings.ini'),
});
const APP = path.join(__dirname, '..', 'app');
const shim = `window.api = new Proxy({}, { get: (_, name) => async (...args) => {
  const r = await (await fetch('/rpc/' + name, { method: 'POST', body: JSON.stringify(args) })).json();
  if (!r.ok) throw new Error(r.error); return r.data; } });`;

http.createServer(async (req, res) => {
  if (req.url.startsWith('/rpc/')) {
    let body = ''; for await (const c of req) body += c;
    try { res.end(JSON.stringify({ ok: true, data: await handlers[req.url.slice(5)](...JSON.parse(body || '[]')) })); }
    catch (e) { res.end(JSON.stringify({ ok: false, error: e.message })); }
    return;
  }
  if (req.url === '/shim.js') { res.setHeader('content-type', 'text/javascript'); return res.end(shim); }
  const file = req.url === '/' ? 'index.html' : req.url.slice(1);
  let data;
  try { data = fs.readFileSync(path.join(APP, path.basename(file))); }
  catch { res.statusCode = 404; return res.end(); } // e.g. favicon.ico
  if (file === 'index.html') data = String(data).replace('<script src="renderer.js">', '<script src="shim.js"></script><script src="renderer.js">');
  res.setHeader('content-type', { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(file)]);
  res.end(data);
}).listen(5178, () => console.log('harness on http://localhost:5178  (fake machine at ' + m.root + ')'));
