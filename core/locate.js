'use strict';
// Finds config files on disk.
// Profile paths are written with forward slashes and may use these tokens:
//   {STEAM}       Steam install folder(s)
//   {STEAMLIB}    every Steam library folder (including the main one)
//   {DOCUMENTS}   the user's Documents folder (handles OneDrive redirection)
//   {SAVEDGAMES}  %USERPROFILE%\Saved Games
//   %VAR%         any environment variable, e.g. %LOCALAPPDATA%
//   *             wildcard inside a path segment, e.g. userdata/*/730
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scanNumericKeys } = require('./editor');
const U = require('./uesave');

function makeContext(overrides = {}) {
  const env = overrides.env || process.env;
  const platform = overrides.platform || process.platform;
  return { env, platform, _cache: {}, ...overrides };
}

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

function regQuery(key, value) {
  try {
    const out = execFileSync('reg', ['query', key, '/v', value], { encoding: 'utf8', windowsHide: true });
    const m = new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`).exec(out);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

function steamRoots(ctx) {
  if (ctx._cache.steamRoots) return ctx._cache.steamRoots;
  const roots = [];
  if (ctx.env.SENSYNC_STEAM) roots.push(...ctx.env.SENSYNC_STEAM.split(path.delimiter));
  if (ctx.platform === 'win32') {
    const reg = regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
    if (reg) roots.push(path.normalize(reg));
    roots.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
  } else if (ctx.env.HOME) {
    roots.push(path.join(ctx.env.HOME, '.steam/steam'), path.join(ctx.env.HOME, '.local/share/Steam'));
  }
  return (ctx._cache.steamRoots = uniqDirs(roots, ctx));
}

/** Existing folders, without the same folder twice under different capitalisation. */
function uniqDirs(list, ctx) {
  const seen = new Map();
  for (const d of list) {
    if (!isDir(d)) continue;
    let real = path.resolve(d);
    try { real = fs.realpathSync.native(real); } catch { /* keep */ }
    const id = ctx.platform === 'win32' ? real.toLowerCase() : real;
    if (!seen.has(id)) seen.set(id, real);
  }
  return [...seen.values()];
}

function steamLibraries(ctx) {
  if (ctx._cache.steamLibs) return ctx._cache.steamLibs;
  const libs = new Set();
  for (const root of steamRoots(ctx)) {
    libs.add(root);
    for (const f of ['steamapps/libraryfolders.vdf', 'config/libraryfolders.vdf']) {
      try {
        const txt = fs.readFileSync(path.join(root, f), 'utf8');
        for (const m of txt.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(path.resolve(m[1].replace(/\\\\/g, '\\')));
      } catch { /* not there */ }
    }
  }
  return (ctx._cache.steamLibs = uniqDirs([...libs], ctx));
}

/** Map installed Steam games: [{appid, name, installdir, library}] */
function steamApps(ctx) {
  if (ctx._cache.steamApps) return ctx._cache.steamApps;
  const apps = [];
  for (const lib of steamLibraries(ctx)) {
    let files = [];
    try { files = fs.readdirSync(path.join(lib, 'steamapps')); } catch { continue; }
    for (const f of files) {
      if (!/^appmanifest_\d+\.acf$/.test(f)) continue;
      try {
        const t = fs.readFileSync(path.join(lib, 'steamapps', f), 'utf8');
        const get = (k) => (new RegExp(`"${k}"\\s+"([^"]*)"`).exec(t) || [])[1];
        apps.push({ appid: get('appid'), name: get('name'), installdir: get('installdir'), library: lib });
      } catch { /* skip */ }
    }
  }
  return (ctx._cache.steamApps = apps);
}

function documentsDirs(ctx) {
  const out = [];
  if (ctx.env.SENSYNC_DOCUMENTS) out.push(ctx.env.SENSYNC_DOCUMENTS);
  if (ctx.platform === 'win32') {
    const reg = regQuery('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders', 'Personal');
    if (reg) out.push(reg);
  }
  const up = ctx.env.USERPROFILE || ctx.env.HOME;
  if (up) out.push(path.join(up, 'Documents'), path.join(up, 'OneDrive', 'Documents'));
  return [...new Set(out)].filter(isDir);
}

function savedGamesDirs(ctx) {
  const up = ctx.env.USERPROFILE || ctx.env.HOME;
  return up ? [path.join(up, 'Saved Games')].filter(isDir) : [];
}

/** Expand tokens into zero or more concrete base strings (still may contain *). */
function expandTokens(pattern, ctx) {
  let bases = [pattern];
  const tokenMap = {
    '{STEAMLIB}': () => steamLibraries(ctx),
    '{STEAM}': () => steamRoots(ctx),
    '{DOCUMENTS}': () => documentsDirs(ctx),
    '{SAVEDGAMES}': () => savedGamesDirs(ctx),
  };
  for (const [tok, fn] of Object.entries(tokenMap)) {
    if (!pattern.includes(tok)) continue;
    const vals = fn();
    bases = bases.flatMap((b) => vals.map((v) => b.split(tok).join(v.replace(/\\/g, '/'))));
  }
  bases = bases.map((b) => b.replace(/%([A-Za-z_]+)%/g, (m, v) => {
    const val = ctx.env[v] ?? ctx.env[v.toUpperCase()];
    return val === undefined ? '\u0000' : val.replace(/\\/g, '/');
  }));
  return bases.filter((b) => !b.includes('\u0000'));
}

function segmentRegex(seg) {
  return new RegExp('^' + seg.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
}

/** Resolve a pattern to existing files. */
function resolvePattern(pattern, ctx) {
  const results = [];
  for (const base of expandTokens(pattern, ctx)) {
    const drive = /^([A-Za-z]:)\//.exec(base);
    let start, rest;
    if (drive) { start = drive[1] + path.sep; rest = base.slice(3); }
    else if (base.startsWith('/')) { start = '/'; rest = base.slice(1); }
    else { start = process.cwd(); rest = base; }
    const segs = rest.split('/').filter(Boolean);
    let current = [start];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const next = [];
      for (const dir of current) {
        if (!seg.includes('*')) {
          // case-insensitive match helps on non-Windows test setups
          const direct = path.join(dir, seg);
          if (exists(direct)) { next.push(direct); continue; }
          try {
            const hit = fs.readdirSync(dir).find((e) => e.toLowerCase() === seg.toLowerCase());
            if (hit) next.push(path.join(dir, hit));
          } catch { /* not a dir */ }
        } else {
          const re = segmentRegex(seg);
          try { for (const e of fs.readdirSync(dir)) if (re.test(e)) next.push(path.join(dir, e)); } catch { /* skip */ }
        }
      }
      current = next;
      if (!current.length) break;
    }
    for (const p of current) if (exists(p) && !isDir(p)) results.push(p);
  }
  return [...new Set(results)];
}

// The same file can be reached by differently-cased paths on Windows (e.g. the registry's
// "c:\program files (x86)\steam" vs "C:\Program Files (x86)\Steam"). Use the real on-disk path.
const realPath = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };

/** Newest-first list of files matching any of the patterns. */
function findFiles(patterns, ctx) {
  const all = new Map();
  for (const p of patterns) {
    for (const f of resolvePattern(p, ctx)) {
      const real = realPath(f);
      const id = ctx.platform === 'win32' ? real.toLowerCase() : real;
      if (!all.has(id)) all.set(id, real);
    }
  }
  return [...all.values()].sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

// ---------------- Discovery for unknown games ----------------
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const CONFIG_EXT = /\.(ini|cfg|vcfg|txt|json|xml|config|conf|properties|lua|yaml|yml|sav)$/i;

function nameMatches(folder, query) {
  const f = norm(folder), q = norm(query);
  if (!f || !q) return false;
  if (f.includes(q) || (f.length >= 4 && q.includes(f))) return true;
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['the', 'and', 'game'].includes(w));
  return words.length > 0 && words.every((w) => f.includes(w));
}

function walk(dir, { maxDepth = 6, maxFiles = 4000 } = {}, depth = 0, out = []) {
  if (depth > maxDepth || out.length >= maxFiles) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/^(shadercache|cache|crashes|logs?|movies|paks?|content|binaries|engine|redist|_commonredist|webcache)$/i.test(e.name)) continue;
      walk(p, { maxDepth, maxFiles }, depth + 1, out);
    } else if (CONFIG_EXT.test(e.name)) {
      out.push(p);
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

/**
 * Search the usual config locations for a game by name.
 * Returns files that contain sensitivity/FOV-looking keys, best first.
 */
function discover(query, ctx) {
  const up = ctx.env.USERPROFILE || ctx.env.HOME || '';
  const local = ctx.env.LOCALAPPDATA || path.join(up, 'AppData', 'Local');
  const roaming = ctx.env.APPDATA || path.join(up, 'AppData', 'Roaming');
  const localLow = path.join(path.dirname(local), 'LocalLow');

  const parents = [local, roaming, ...documentsDirs(ctx), ...documentsDirs(ctx).map((d) => path.join(d, 'My Games')), ...savedGamesDirs(ctx)];
  const roots = new Set();
  for (const parent of parents) {
    let entries = [];
    try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (nameMatches(e.name, query)) { roots.add(path.join(parent, e.name)); continue; }
      // <Company>/<Game>, e.g. AppData/Local/CD Projekt Red/Cyberpunk 2077
      if (parent !== local && parent !== roaming) continue;
      try {
        for (const g of fs.readdirSync(path.join(parent, e.name), { withFileTypes: true })) {
          if (g.isDirectory() && nameMatches(g.name, query)) roots.add(path.join(parent, e.name, g.name));
        }
      } catch { /* skip */ }
    }
  }
  // Unity: LocalLow/<Company>/<Game>
  try {
    for (const company of fs.readdirSync(localLow)) {
      const cdir = path.join(localLow, company);
      if (nameMatches(company, query)) roots.add(cdir);
      try { for (const g of fs.readdirSync(cdir)) if (nameMatches(g, query)) roots.add(path.join(cdir, g)); } catch { /* skip */ }
    }
  } catch { /* skip */ }
  // Steam installs + Steam Cloud userdata
  for (const app of steamApps(ctx)) {
    if (!nameMatches(app.name, query) && !nameMatches(app.installdir, query)) continue;
    roots.add(path.join(app.library, 'steamapps', 'common', app.installdir));
    for (const root of steamRoots(ctx)) {
      try {
        for (const user of fs.readdirSync(path.join(root, 'userdata'))) {
          const d = path.join(root, 'userdata', user, app.appid);
          if (isDir(d)) roots.add(d);
        }
      } catch { /* skip */ }
    }
  }

  const found = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      let keys, readOnly = false;
      try {
        const st = fs.statSync(file);
        if (st.size > 2 * 1024 * 1024) continue;
        keys = scanFile(file).keys.filter((k) => k.kind);
        readOnly = /\.sav$/i.test(file);
      } catch { continue; }
      if (!keys) continue;
      if (!keys.length) continue;
      const score = keys.reduce((s, k) => s + k.score, 0) + (/user|setting|config|input/i.test(path.basename(file)) ? 2 : 0);
      found.push({ file, keys, score, readOnly, mtime: fs.statSync(file).mtimeMs });
    }
  }
  found.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return { searched: [...roots], files: found.slice(0, 40) };
}

/** Scan any supported file for numeric keys. Text configs and string-based UE .sav files. */
function scanFile(file) {
  const buf = fs.readFileSync(file);
  const { classify } = require('./editor');
  if (U.isGvas(buf)) {
    return { file, format: 'uesave-strings', readOnly: true, keys: U.scanPairs(buf).map((p) => ({ ...p, section: null, ...classify(p.key) })).sort((a, b) => b.score - a.score) };
  }
  const text = buf.toString('utf8');
  if (text.includes('\u0000')) return { file, format: 'binary', readOnly: true, keys: [] };
  return { file, format: 'text', readOnly: false, keys: scanNumericKeys(text) };
}

/** Is the game's process running? (Windows only; returns false elsewhere.) */
function isProcessRunning(exeNames, ctx) {
  if (!exeNames || !exeNames.length || ctx.platform !== 'win32') return false;
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }).toLowerCase();
    return exeNames.some((n) => out.includes(`"${n.toLowerCase()}"`));
  } catch { return false; }
}

module.exports = {
  makeContext, steamRoots, steamLibraries, steamApps, documentsDirs,
  expandTokens, resolvePattern, findFiles, discover, isProcessRunning, nameMatches, scanFile,
};
