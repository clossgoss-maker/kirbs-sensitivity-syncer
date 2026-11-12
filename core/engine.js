'use strict';
// Ties everything together: load profiles, work out values, preview edits, back up, write, restore.
const fs = require('fs');
const path = require('path');
const M = require('./math');
const E = require('./editor');
const L = require('./locate');
const U = require('./uesave');
const C = require('./community');

const BUILTIN = JSON.parse(fs.readFileSync(path.join(__dirname, 'games.json'), 'utf8')).games;
const PRESETS = JSON.parse(fs.readFileSync(path.join(__dirname, 'presets.json'), 'utf8')).presets;

// ---------------- storage (app data folder) ----------------
function store(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const f = (n) => path.join(dataDir, n);
  const read = (n, d) => { try { return JSON.parse(fs.readFileSync(f(n), 'utf8')); } catch { return d; } };
  const write = (n, v) => fs.writeFileSync(f(n), JSON.stringify(v, null, 2));
  return {
    dataDir,
    backupDir: f('backups'),
    getPrefs: () => ({ cm360: 30, dpi: 800, aspect: 16 / 9, fov: { enabled: false, value: 103, type: 'h169' }, games: {}, ...read('prefs.json', {}) }),
    setPrefs: (p) => write('prefs.json', p),
    getUserGames: () => read('games.user.json', []),
    setUserGames: (g) => write('games.user.json', g),
    communityFile: f('community.cache.json'),
    getCommunity: () => C.loadLibrary(f('community.cache.json'), PRESETS),
    getHistory: () => C.loadHistory(f('community.cache.json')),
  };
}

// built-in profiles, then the shared library, then games you added (yours win on the same id)
function allGames(st) {
  const user = st ? st.getUserGames() : [];
  const byId = new Map(BUILTIN.map((g) => [g.id, { ...g, builtin: true }]));
  for (const g of (st && st.getCommunity ? st.getCommunity() : [])) {
    if (!byId.has(g.id)) byId.set(g.id, { ...g, community: true });
  }
  for (const g of user) {
    const base = byId.get(g.id) || {};
    // inLibrary: your own copy of a game that's also in the shared library
    byId.set(g.id, { ...base, ...g, builtin: !!base.builtin, community: false, custom: true, inLibrary: !!base.community });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';
}

// ---------------- values ----------------
/** Work out the yaw for a game: per-game calibration beats the profile's built-in number. */
function effectiveYaw(game, gamePrefs = {}) {
  if (gamePrefs.calibration) {
    const c = gamePrefs.calibration;
    return M.yawFromMeasurement(c.sens, c.dpi, c.cm360);
  }
  return game.yaw || null;
}

/**
 * Compute what to write. Returns { sens, fov, fovDeg, warnings, yaw, source }.
 * prefs: { cm360, dpi, aspect, fov:{enabled,value,type}, games:{ [id]: { manualSens, calibration, filePaths, keepFov } } }
 * calibration: { sens, cm360, dpi, fov? } where fov is the game's FOV (in its own units) when it was calibrated.
 * keepFov: leave this game's FOV alone even when Match FOV is on. fovMatch: set it even when Match FOV is off.
 */
function computeValues(game, prefs) {
  const gp = (prefs.games && prefs.games[game.id]) || {};
  const warnings = [];
  const out = { warnings, sens: null, fov: null, fovDeg: null, yaw: null, source: null };
  const sensCfg = game.sens || {};
  const decimals = sensCfg.decimals ?? 6;

  if (gp.manualSens != null && gp.manualSens !== '') {
    out.sens = Number(gp.manualSens);
    out.source = 'pasted value';
  } else {
    const yaw = effectiveYaw(game, gp);
    out.yaw = yaw;
    if (!yaw) {
      warnings.push('This game needs a one-time setup: paste a value from mouse-sensitivity.com or calibrate it.');
    } else {
      out.sens = M.round(M.sensFromCm(prefs.cm360, prefs.dpi, yaw), decimals);
      out.source = gp.calibration ? 'calibrated' : 'calculated';
    }
  }
  if (out.sens != null && sensCfg.range) {
    const [lo, hi] = sensCfg.range;
    if (out.sens < lo || out.sens > hi) warnings.push(`Sensitivity ${out.sens} is outside what the game allows (${lo} to ${hi}). Try changing your DPI.`);
  }

  // per game: fovMatch sets it to your target even with Match FOV off, keepFov leaves it alone
  if (game.fov && prefs.fov && (prefs.fov.enabled || gp.fovMatch) && !gp.keepFov) {
    let fdeg = M.convertFov(prefs.fov.value, prefs.fov.type, game.fov.type, prefs.aspect);
    if (game.fov.range) {
      const [lo, hi] = game.fov.range;
      if (fdeg < lo || fdeg > hi) {
        warnings.push(`Your FOV works out to ${M.round(fdeg, 2)} in this game's terms, but it only allows ${lo} to ${hi}. Using ${fdeg < lo ? lo : hi}.`);
        fdeg = Math.min(hi, Math.max(lo, fdeg));
      }
    }
    out.fovDeg = M.round(fdeg, 4);
    out.fov = M.round(M.fovToConfigValue(fdeg, game.fov.map), game.fov.decimals ?? 4);
  } else if (game.fixedFov && prefs.fov && prefs.fov.enabled) {
    const theirs = M.convertFov(game.fixedFov.value, game.fixedFov.type, prefs.fov.type, prefs.aspect);
    if (Math.abs(theirs - prefs.fov.value) > 0.5) {
      warnings.push(`This game's FOV is fixed. It works out to about ${M.round(theirs, 1)} in your FOV terms, so it won't match.`);
    }
  }

  // FOV changes this game's sensitivity, so the calibration only holds at the FOV it was made at
  // (your own calibration's FOV, or the FOV a shared yaw was calibrated at)
  const cal = gp.calibration;
  const calFov = cal ? cal.fov : gp.manualSens == null ? game.calFov : null;
  if (game.fovAffectsSens && calFov != null && out.fov != null && Math.abs(out.fov - calFov) > 0.5) {
    warnings.push(`FOV changes this game's sensitivity. It was calibrated at FOV ${calFov} and you're now setting ${out.fov}, so the cm/360 will be off. Recalibrate in Set up, or keep its FOV at ${calFov}.`);
  }
  if (out.source === 'calculated' && game.community && !game.preset) out.source = 'shared yaw';
  return out;
}

/** The FOV a game will have after Apply, in its own units: what we'd write, or what's in the config now. */
function fovAfterApply(game, prefs, current) {
  const v = computeValues(game, prefs);
  if (v.fov != null) return v.fov;
  return current && current.fovRaw != null ? current.fovRaw : null;
}

// ---------------- files ----------------
function filesFor(game, fileId, prefs, ctx) {
  const gp = (prefs.games && prefs.games[game.id]) || {};
  const manual = gp.filePaths && gp.filePaths[fileId];
  if (manual) return fs.existsSync(manual) ? [manual] : [];
  const spec = game.files && game.files[fileId];
  if (!spec) return [];
  const found = L.findFiles(spec.paths || [], ctx);
  return spec.editAll ? found : found.slice(0, 1);
}

// ---------------- reading what's set now ----------------
function readRawValues(file, format, keys, section) {
  const out = {};
  if (format === 'uesave-strings') {
    const buf = fs.readFileSync(file);
    for (const k of keys) out[k] = U.readNumber(buf, k);
  } else {
    const text = fs.readFileSync(file, 'utf8');
    for (const k of keys) { const h = E.findKey(text, k, { section }); out[k] = h.length ? h[0].value : null; }
  }
  return out;
}

/**
 * Read the sensitivity/FOV the game is using right now and convert to cm/360 + your FOV terms.
 * Returns null when the game has no readable file.
 */
function readCurrent(game, prefs, ctx) {
  const gp = (prefs.games && prefs.games[game.id]) || {};
  const rd = game.read || {};
  const sc = game.sens || {};
  const fileId = rd.file || sc.file;
  const sensKey = rd.sensKey || (sc.keys || [])[0];
  if (!fileId || !sensKey || !(game.files && game.files[fileId])) return null;
  const files = filesFor(game, fileId, prefs, ctx);
  if (!files.length) return { error: 'config not found' };
  const file = files[0];
  const format = game.files[fileId].format;
  const out = { file, sens: null, cm360: null, fovRaw: null, fov: null, note: null };
  try {
    const scaleBy = rd.scaleBy || {}; // e.g. Siege: { MouseYawSensitivity: 50 }
    const alsoKeys = Object.keys(scaleBy);
    const fovKey = rd.fovKey || (game.fov && game.fov.file === fileId ? game.fov.key : null);
    const raw = readRawValues(file, format, [sensKey, ...alsoKeys, ...(fovKey ? [fovKey] : [])], sc.section);
    out.sens = raw[sensKey];
    if (out.sens == null) return { ...out, error: `"${sensKey}" not in file yet (change it in-game once)` };
    // e.g. Siege: the multiplier only means what we think while the slider is at 50
    let effective = out.sens;
    for (const k of alsoKeys) if (raw[k] != null) effective *= raw[k] / scaleBy[k];
    const yaw = gp.manualSens != null ? null : effectiveYaw(game, gp);
    if (yaw) out.cm360 = M.round(M.cmFromSens(effective, prefs.dpi, yaw), 2);
    else out.note = 'needs setup to convert';
    let fovRaw = fovKey ? raw[fovKey] : null;
    if (fovRaw == null && game.fov && game.fov.file && game.fov.key && game.fov.file !== fileId) {
      const ff = filesFor(game, game.fov.file, prefs, ctx)[0];
      if (ff) fovRaw = readRawValues(ff, game.files[game.fov.file].format, [game.fov.key], game.fov.section)[game.fov.key];
    }
    if (fovRaw != null) {
      out.fovRaw = fovRaw;
      const ftype = (game.fov && game.fov.type) || rd.fovType;
      if (ftype && prefs.fov) {
        const deg = M.configValueToFov(fovRaw, game.fov && game.fov.map);
        out.fov = M.round(M.convertFov(deg, ftype, prefs.fov.type, prefs.aspect), 1);
      }
    }
  } catch (e) {
    return { ...out, error: e.message };
  }
  return out;
}

/** Status for the game list: is it set up, is its config found. */
function status(game, prefs, ctx) {
  const v = computeValues(game, prefs);
  const files = {};
  let anyFound = false;
  for (const id of Object.keys(game.files || {})) {
    files[id] = filesFor(game, id, prefs, ctx);
    if (files[id].length) anyFound = true;
  }
  return {
    id: game.id,
    name: game.name,
    apply: game.apply,
    custom: !!game.custom,
    found: game.apply === 'manual' && !Object.keys(game.files || {}).length ? null : anyFound,
    current: readCurrent(game, prefs, ctx),
    pending: anyFound ? pendingChanges(game, prefs, ctx) : null,
    files,
    values: v,
    notes: game.notes || '',
  };
}

/**
 * The values an Apply would actually change: [{file, key, from, to}]. Empty = config already matches.
 * null when it can't be worked out (manual game, needs setup, file problems).
 */
function pendingChanges(game, prefs, ctx) {
  if (game.apply !== 'file') return null;
  const p = plan(game, prefs, ctx);
  if (p.values.sens == null || p.errors.length) return null;
  const out = [];
  for (const e of p.edits) {
    if (e.error) return null;
    for (const c of e.changes) {
      const a = parseFloat(c.from), b = parseFloat(c.to);
      const same = !c.inserted && Number.isFinite(a) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
      if (!same) out.push({ file: e.file, key: c.key, from: c.from, to: c.to });
    }
  }
  return out;
}

/**
 * Build the list of edits (without writing). Each edit:
 *   { file, changes:[{key, from, to, inserted}], newText, error }
 */
function plan(game, prefs, ctx) {
  const v = computeValues(game, prefs);
  const result = { game: game.id, values: v, edits: [], errors: [], manual: game.apply === 'manual' };
  if (result.manual) return result;
  if (v.sens == null) { // never write a half-change
    result.errors.push(...v.warnings);
    result.values = { ...v, warnings: [] };
    return result;
  }

  const wanted = []; // {fileId, key, value, section, decimals, insert}
  if (v.sens != null && game.sens) {
    for (const key of game.sens.keys || []) {
      wanted.push({ fileId: game.sens.file, key, value: v.sens, section: game.sens.section, decimals: game.sens.decimals ?? 6, insert: game.sens.insert });
    }
    for (const [key, val] of Object.entries(game.sens.also || {})) {
      wanted.push({ fileId: game.sens.file, key, value: val, section: game.sens.section, decimals: 0, insert: game.sens.insert, optional: true });
    }
  }
  if (v.fov != null && game.fov && game.fov.file) {
    wanted.push({ fileId: game.fov.file, key: game.fov.key, value: v.fov, section: game.fov.section, decimals: game.fov.decimals ?? 4, insert: game.fov.insert });
  }
  if (!wanted.length) { result.errors.push(...(v.warnings.length ? v.warnings : ['Nothing to change.'])); return result; }

  const byFile = new Map();
  for (const w of wanted) {
    const files = filesFor(game, w.fileId, prefs, ctx);
    if (!files.length) {
      const msg = `Couldn't find the ${w.fileId} config file. Launch the game once so it creates the file, or choose it yourself with "Choose file…".`;
      if (!result.errors.includes(msg)) result.errors.push(msg);
      continue;
    }
    for (const f of files) {
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(w);
    }
  }

  for (const [file, ws] of byFile) {
    const edit = { file, changes: [], newText: null, error: null };
    try {
      let text = fs.readFileSync(file, 'utf8');
      for (const w of ws) {
        const before = E.findKey(text, w.key, { section: w.section });
        if (!before.length && w.optional) continue;
        const r = E.setKey(text, w.key, w.value, { section: w.section, decimals: w.decimals, insert: w.insert });
        if (!r.changed.length && !r.inserted) {
          edit.error = `Couldn't find "${w.key}" in this file.`;
          continue;
        }
        text = r.text;
        edit.changes.push({ key: w.key, from: before.length ? before[0].raw : null, to: E.formatNumber(w.value, w.decimals), inserted: r.inserted });
      }
      edit.newText = text;
    } catch (e) {
      edit.error = e.message;
    }
    result.edits.push(edit);
  }
  return result;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function writeFileForce(file, text) {
  try {
    fs.writeFileSync(file, text, 'utf8');
  } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
    const mode = fs.statSync(file).mode;
    fs.chmodSync(file, mode | 0o200); // clear read-only
    fs.writeFileSync(file, text, 'utf8');
    fs.chmodSync(file, mode); // put it back the way it was
  }
}

/** Back up and write. Refuses if the game is running (it would overwrite our edit on exit). */
function apply(game, prefs, ctx, st, { force = false } = {}) {
  const p = plan(game, prefs, ctx);
  if (p.manual) return { ...p, applied: false };
  if (!force && L.isProcessRunning(game.process, ctx)) {
    return { ...p, applied: false, errors: [...p.errors, `${game.name} is running. Close it first, or it will overwrite the change when it exits.`] };
  }
  const todo = p.edits.filter((e) => e.newText != null && e.changes.length);
  if (!todo.length) return { ...p, applied: false };

  const dir = path.join(st.backupDir, game.id, stamp());
  fs.mkdirSync(dir, { recursive: true });
  const manifest = [];
  todo.forEach((e, i) => {
    const copy = path.join(dir, `${i}-${path.basename(e.file)}`);
    fs.copyFileSync(e.file, copy);
    manifest.push({ original: e.file, backup: copy });
  });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  for (const e of todo) {
    writeFileForce(e.file, e.newText);
    e.written = true;
  }
  return { ...p, applied: true, backup: dir };
}

function listBackups(gameId, st) {
  const d = path.join(st.backupDir, gameId);
  try { return fs.readdirSync(d).filter((n) => fs.existsSync(path.join(d, n, 'manifest.json'))).sort().reverse().map((n) => path.join(d, n)); } catch { return []; }
}

function restore(gameId, st, which) {
  const dir = which || listBackups(gameId, st)[0];
  if (!dir) throw new Error('No backups for this game yet.');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const m of manifest) writeFileForce(m.original, fs.readFileSync(m.backup, 'utf8'));
  return { restored: manifest.map((m) => m.original), from: dir };
}

/**
 * Create/update a custom game from the wizard.
 * input: { name, process?, sensFile | sensFiles[], sensKey(s), sensSection?, fovFile?, fovKey?, fovType?, fovSection?,
 *          yaw?, notes?, sensRange?, fovRange?, sensDecimals?, fovDecimals?, manual? }
 * manual: true makes a type-in-game game with no config file (needs fovType for a FOV value).
 */
function saveCustomGame(input, st) {
  const games = st.getUserGames();
  const id = input.id || slug(input.name);
  const range = (r) => (Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) ? r.map(Number) : undefined);

  if (input.manual) {
    const game = {
      id, name: input.name, process: input.process ? [].concat(input.process) : [],
      yaw: input.yaw ? Number(input.yaw) : null, apply: 'manual', files: {},
      sens: { range: range(input.sensRange), decimals: input.sensDecimals ?? 3 },
      fov: input.fovType ? { type: input.fovType, range: range(input.fovRange), decimals: input.fovDecimals ?? 0 } : null,
      fovAffectsSens: input.fovAffectsSens === true || undefined,
      notes: input.notes || 'Added by you. Type the value in-game.',
    };
    const i = games.findIndex((g) => g.id === id);
    if (i >= 0) games[i] = game; else games.push(game);
    st.setUserGames(games);
    return game;
  }

  const sensFiles = [].concat(input.sensFiles || input.sensFile).filter(Boolean);
  if (!sensFiles.length) throw new Error('Choose the config file first.');
  const isSave = /\.sav$/i.test(sensFiles[0]);
  const files = { sens: { paths: sensFiles.map((f) => f.replace(/\\/g, '/')), ...(sensFiles.length > 1 ? { editAll: true } : {}), ...(isSave ? { format: 'uesave-strings' } : {}) } };
  let fov = null;
  if (input.fovKey) {
    const same = !input.fovFile || sensFiles.includes(input.fovFile);
    if (!same) files.fov = { paths: [input.fovFile.replace(/\\/g, '/')] };
    fov = { file: same ? 'sens' : 'fov', key: input.fovKey, type: input.fovType || 'h169', section: input.fovSection || undefined, range: range(input.fovRange), decimals: input.fovDecimals ?? 4 };
  }
  const keys = Array.isArray(input.sensKeys) ? input.sensKeys : [input.sensKey];
  const game = {
    id,
    name: input.name,
    process: input.process ? [].concat(input.process) : [],
    yaw: input.yaw ? Number(input.yaw) : null,
    apply: isSave ? 'manual' : 'file',
    files,
    sens: { file: 'sens', keys, section: input.sensSection || undefined, range: range(input.sensRange), decimals: input.sensDecimals ?? (isSave ? 2 : 6) },
    fov: isSave ? null : fov,
    fovAffectsSens: input.fovAffectsSens === true || undefined,
    ...(isSave ? { read: { file: 'sens', sensKey: keys[0], fovKey: input.fovKey || undefined, fovType: input.fovType } } : {}),
    notes: (input.notes || 'Added by you.') + (isSave ? ' Binary save file, so Kirb reads it but you type the value in-game.' : ''),
  };
  const i = games.findIndex((g) => g.id === id);
  if (i >= 0) games[i] = game; else games.push(game);
  st.setUserGames(games);
  return game;
}

function deleteCustomGame(id, st) {
  st.setUserGames(st.getUserGames().filter((g) => g.id !== id));
}

module.exports = {
  BUILTIN, PRESETS, store, allGames, computeValues, fovAfterApply, effectiveYaw, filesFor, status, plan, apply,
  listBackups, restore, saveCustomGame, deleteCustomGame, slug, readCurrent, pendingChanges,
};
