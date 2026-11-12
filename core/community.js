'use strict';
// The shared game library: games people contribute through GitHub, so everyone who installs the app
// gets them ready to go: where the config is, which settings, ranges, FOV type, and the game's yaw
// (from the sharer's calibration) so friends don't have to calibrate. Your own calibration always wins.
// The repo owner chose to share yaws for a private group of friends, knowing mouse-sensitivity.com's
// terms don't allow redistributing its numbers.
//
// Profiles come from strangers, so everything here is validated against a strict allowlist:
// paths must sit under known game-config roots and look like config files, and unknown fields are dropped.
const fs = require('fs');
const path = require('path');

const PKG = require('../package.json');
const REPO = (PKG.kirb && PKG.kirb.repo) || null; // "owner/name"
const BRANCH = 'main';
const LIBRARY_URL = REPO ? `https://raw.githubusercontent.com/${REPO}/${BRANCH}/community/games.json` : null;
const BUNDLED = path.join(__dirname, '..', 'community', 'games.json');

const ROOTS = ['{STEAMLIB}/', '{STEAM}/', '{DOCUMENTS}/', '{SAVEDGAMES}/', '%LOCALAPPDATA%/', '%APPDATA%/', '%USERPROFILE%/'];
const CONFIG_EXT = /\.(ini|cfg|vcfg|json|xml|txt|sav|lua|config|conf|yaml|yml|properties)$/i;
const FOV_TYPES = ['h43', 'h169', 'v', 'hnative'];
const KEY_RE = /^[\w.\-/[\] ]{1,80}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;
const CLEAN_TEXT = (s, max) => (typeof s === 'string' && !/[\u0000-\u001f<>]/.test(s) && s.trim().length && s.length <= max ? s.trim() : null);

function cleanRange(r, errors, what) {
  if (r == null) return undefined;
  if (Array.isArray(r) && r.length === 2 && r.every((n) => typeof n === 'number' && Number.isFinite(n)) && r[0] < r[1]) return r;
  errors.push(`${what} range must be [min, max]`);
  return undefined;
}
const cleanDecimals = (d) => (Number.isInteger(d) && d >= 0 && d <= 8 ? d : undefined);

function cleanPath(p, errors) {
  if (typeof p !== 'string' || p.length > 300 || /[\u0000-\u001f"<>|?]/.test(p)) { errors.push(`bad path: ${String(p).slice(0, 80)}`); return null; }
  const s = p.replace(/\\/g, '/');
  if (!ROOTS.some((r) => s.startsWith(r))) { errors.push(`path must start with one of ${ROOTS.join(' ')}: ${s}`); return null; }
  if (s.split('/').some((seg) => seg === '..' || seg === '.')) { errors.push(`path can't contain . or ..: ${s}`); return null; }
  if (!CONFIG_EXT.test(s)) { errors.push(`path must be a config file: ${s}`); return null; }
  return s;
}

/**
 * Check a contributed profile. Returns { ok, errors, profile } where profile holds only allowed fields.
 * presets: the app's engine presets, so a profile can name one instead of carrying a yaw.
 */
function validateProfile(p, presets = []) {
  const errors = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, errors: ['not an object'], profile: null };
  const out = {};
  if (typeof p.id === 'string' && ID_RE.test(p.id)) out.id = p.id; else errors.push('id must be lowercase letters, numbers and dashes');
  out.name = CLEAN_TEXT(p.name, 80); if (!out.name) errors.push('name is required (max 80 characters)');
  out.apply = p.apply === 'manual' ? 'manual' : p.apply === 'file' ? 'file' : (errors.push('apply must be "file" or "manual"'), null);

  out.files = {};
  const files = p.files && typeof p.files === 'object' ? p.files : {};
  const ids = Object.keys(files);
  if (ids.length > 4) errors.push('at most 4 files');
  for (const fid of ids.slice(0, 4)) {
    if (!/^[a-z]{1,20}$/i.test(fid)) { errors.push(`bad file id ${fid}`); continue; }
    const f = files[fid] || {};
    const paths = (Array.isArray(f.paths) ? f.paths.slice(0, 4) : []).map((x) => cleanPath(x, errors)).filter(Boolean);
    if (!paths.length) { errors.push(`file "${fid}" needs at least one path`); continue; }
    out.files[fid] = { paths, ...(f.editAll === true ? { editAll: true } : {}), ...(f.format === 'uesave-strings' ? { format: 'uesave-strings' } : {}) };
  }
  if (out.apply === 'file' && !Object.keys(out.files).length) errors.push('a file game needs a config file');

  const s = p.sens && typeof p.sens === 'object' ? p.sens : null;
  if (!s) errors.push('sens is required');
  else {
    out.sens = { range: cleanRange(s.range, errors, 'sens'), decimals: cleanDecimals(s.decimals) };
    if (out.apply === 'file') {
      if (!out.files[s.file]) errors.push('sens.file must name one of the files');
      const keys = Array.isArray(s.keys) ? s.keys.slice(0, 4).filter((k) => typeof k === 'string' && KEY_RE.test(k)) : [];
      if (!keys.length) errors.push('sens.keys must list the setting names');
      Object.assign(out.sens, { file: s.file, keys });
      if (s.section != null) out.sens.section = CLEAN_TEXT(s.section, 120) || undefined;
      if (s.insert && ['source', 'ini', 'vcfg'].includes(s.insert)) out.sens.insert = s.insert;
    }
  }

  if (p.fov) {
    const f = p.fov;
    if (!FOV_TYPES.includes(f.type)) errors.push(`fov.type must be one of ${FOV_TYPES.join(', ')}`);
    out.fov = { type: f.type, range: cleanRange(f.range, errors, 'fov'), decimals: cleanDecimals(f.decimals) };
    if (out.apply === 'file' && f.key != null) {
      if (!out.files[f.file]) errors.push('fov.file must name one of the files');
      if (typeof f.key !== 'string' || !KEY_RE.test(f.key)) errors.push('fov.key is not a valid setting name');
      Object.assign(out.fov, { file: f.file, key: f.key });
      if (f.section != null) out.fov.section = CLEAN_TEXT(f.section, 120) || undefined;
    }
  } else out.fov = null;

  if (p.fovAffectsSens === true) out.fovAffectsSens = true;
  if (p.preset != null) {
    const pr = presets.find((x) => x.id === p.preset);
    if (pr) { out.preset = pr.id; out.yaw = pr.yaw; } else errors.push(`unknown preset ${p.preset}`);
  } else if (p.yaw != null) {
    // the sharer's calibrated yaw: degrees per mouse count at sensitivity 1
    if (typeof p.yaw === 'number' && Number.isFinite(p.yaw) && p.yaw > 0 && p.yaw < 1000) out.yaw = Number(p.yaw.toPrecision(10));
    else errors.push('yaw must be a positive number');
  }
  // the FOV (game's own units) the yaw was calibrated at, for games whose sensitivity depends on FOV
  if (p.calFov != null) {
    if (typeof p.calFov === 'number' && p.calFov > 0 && p.calFov < 1000) out.calFov = p.calFov;
    else errors.push('calFov must be a number');
  }
  out.process = (Array.isArray(p.process) ? p.process : []).filter((x) => typeof x === 'string' && /^[\w .\-]{1,60}\.exe$/i.test(x)).slice(0, 4);
  out.notes = CLEAN_TEXT(p.notes, 300) || 'Shared by the community. Calibrate it once with the mouse-sensitivity.com panel.';
  if (p.read != null) errors.push('read settings are not shared');

  // strip undefined so the JSON stays tidy
  const json = JSON.parse(JSON.stringify(out));
  return { ok: errors.length === 0, errors, profile: errors.length ? null : json };
}

/**
 * Turn a game added on this PC into a shareable profile: absolute paths become tokens
 * ({STEAMLIB}, %LOCALAPPDATA%, …), Steam account folders become *, and the yaw from this PC's
 * calibration goes along (with the FOV it was calibrated at). Your cm/360, DPI and the site's notes don't.
 * roots: { steamLibs, steamRoots, documents, savedGames, env }
 */
function shareableProfile(game, roots, { note, presets = [], yaw, calFov } = {}) {
  const errors = [];
  const norm = (p) => p.replace(/\\/g, '/');
  const lower = (p) => norm(p).toLowerCase();
  const swaps = [];
  const add = (dir, token) => { if (dir) swaps.push({ dir: norm(dir).replace(/\/+$/, ''), token }); };
  for (const l of roots.steamLibs || []) add(l, '{STEAMLIB}');
  for (const r of roots.steamRoots || []) add(r, '{STEAM}');
  for (const d of roots.documents || []) add(d, '{DOCUMENTS}');
  for (const d of roots.savedGames || []) add(d, '{SAVEDGAMES}');
  const env = roots.env || {};
  add(env.LOCALAPPDATA, '%LOCALAPPDATA%');
  add(env.APPDATA, '%APPDATA%');
  add(env.USERPROFILE, '%USERPROFILE%');
  swaps.sort((a, b) => b.dir.length - a.dir.length); // most specific first

  const tokenize = (p) => {
    const s = norm(p);
    // Steam library files only make sense inside steamapps; userdata lives under the Steam root
    for (const { dir, token } of swaps) {
      if (!lower(s).startsWith(dir.toLowerCase() + '/')) continue;
      let rest = s.slice(dir.length + 1);
      if (token === '{STEAMLIB}' && !/^steamapps\//i.test(rest)) continue;
      if (token === '{STEAM}') rest = rest.replace(/^userdata\/\d+\//i, 'userdata/*/'); // don't share Steam account IDs
      return `${token}/${rest}`;
    }
    if (/^[a-z]:\//i.test(s) || s.startsWith('/')) { errors.push(`"${s}" is in a place specific to this PC, so it can't be shared.`); return null; }
    return s;
  };

  const files = {};
  for (const [fid, f] of Object.entries(game.files || {})) {
    files[fid] = { ...f, paths: (f.paths || []).map(tokenize).filter(Boolean) };
  }
  const draft = {
    id: game.id, name: game.name, apply: game.apply, files,
    sens: game.sens, fov: game.fov || null, fovAffectsSens: game.fovAffectsSens,
    process: game.process, notes: note || undefined,
  };
  const y = yaw != null ? yaw : game.yaw;
  const preset = y ? presets.find((p) => Math.abs(p.yaw - y) < 1e-9) : null;
  if (preset) draft.preset = preset.id; // a known engine: share the name, not the number
  else if (y) draft.yaw = y;
  if (y && calFov != null) draft.calFov = calFov;
  const v = validateProfile(draft, presets);
  return { ok: !errors.length && v.ok, errors: [...errors, ...v.errors], profile: v.profile };
}

/** Bundled library, then the cached download (newer) if there is one. */
function loadLibrary(cacheFile, presets) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const raw = (cacheFile && read(cacheFile)) || read(BUNDLED) || { games: [] };
  return (Array.isArray(raw.games) ? raw.games : []).map((g) => validateProfile(g, presets)).filter((v) => v.ok).map((v) => v.profile);
}

/** Download the latest library from GitHub and cache it. Returns how many games it has, or null. */
async function refreshLibrary(cacheFile, presets, fetchImpl = globalThis.fetch) {
  if (!LIBRARY_URL || !fetchImpl) return null;
  const res = await fetchImpl(LIBRARY_URL, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !Array.isArray(data.games)) return null;
  const valid = data.games.map((g) => validateProfile(g, presets)).filter((v) => v.ok).map((v) => v.profile);
  fs.writeFileSync(cacheFile, JSON.stringify({ games: valid }, null, 2));
  return valid.length;
}

/** GitHub "new issue" link that opens the share form with this profile filled in. */
function shareUrl(profile) {
  if (!REPO) return null;
  const q = new URLSearchParams({
    template: 'new-game.yml',
    title: `New game: ${profile.name}`,
    profile: JSON.stringify(profile, null, 2),
  });
  return `https://github.com/${REPO}/issues/new?${q}`;
}

module.exports = { validateProfile, shareableProfile, loadLibrary, refreshLibrary, shareUrl, REPO, LIBRARY_URL, ROOTS };
