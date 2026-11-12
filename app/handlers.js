'use strict';
// All the app's actions, shared by the Electron main process and the browser test harness.
const fs = require('fs');
const E = require('../core/engine');
const L = require('../core/locate');
const Ed = require('../core/editor');
const M = require('../core/math');
const MS = require('../core/msimport');
const C = require('../core/community');
const path = require('path');

// Current value of a key in a text config, or null
function keyNow(file, key) {
  if (!key) return null;
  try { const h = Ed.findKey(fs.readFileSync(file, 'utf8'), key); return h.length ? h[0].value : null; } catch { return null; }
}

function makeHandlers(st, makeCtx, host = {}) {
  let ctx = makeCtx();
  const fresh = () => (ctx = makeCtx());

  const game = (id) => {
    const g = E.allGames(st).find((x) => x.id === id);
    if (!g) throw new Error(`Unknown game ${id}`);
    return g;
  };

  function state() {
    const prefs = st.getPrefs();
    const games = E.allGames(st).map((g) => {
      const s = E.status(g, prefs, ctx);
      // the FOV a calibration made now would be made at (game's own units)
      return { ...s, fovForCal: g.fov ? E.fovAfterApply(g, prefs, s.current) : null, fovAffectsSens: !!g.fovAffectsSens, ...rest(g, prefs) };
    });
    return { prefs, games, dataDir: st.dataDir, presets: E.PRESETS };
  }

  function rest(g, prefs) {
    return {
      yaw: E.effectiveYaw(g, prefs.games[g.id] || {}),
      hasFov: !!g.fov,
      fovType: g.fov ? g.fov.type : null,
      fixedFov: g.fixedFov || null,
      gamePrefs: prefs.games[g.id] || {},
      backups: E.listBackups(g.id, st).length,
      builtin: !!g.builtin,
      community: !!g.community,
      fileIds: Object.keys(g.files || {}),
    };
  }

  return {
    state: () => { fresh(); return state(); },
    savePrefs: (p) => { const cur = st.getPrefs(); st.setPrefs({ ...cur, ...p, games: cur.games }); return state(); },
    setGamePrefs: (id, patch) => {
      const p = st.getPrefs();
      p.games[id] = { ...(p.games[id] || {}), ...patch };
      for (const k of Object.keys(p.games[id])) if (p.games[id][k] === null) delete p.games[id][k];
      st.setPrefs(p);
      return state();
    },
    preview: (id) => E.plan(game(id), st.getPrefs(), ctx),
    apply: (id, force) => E.apply(game(id), st.getPrefs(), ctx, st, { force }),
    restore: (id) => E.restore(id, st),
    discover: (q) => L.discover(q, fresh()),
    scanFile: (file) => L.scanFile(file),
    // Read a Game Info box pasted from mouse-sensitivity.com and look for its config files
    // Returns { draft, files, match } where match = the config file + settings holding this game's
    // sensitivity right now: { file, files, source, sens, sensAlso, fov } or null.
    importText: (text) => {
      const draft = MS.parse(text);
      const c = fresh();
      const files = draft.kind !== 'file' ? [] : draft.paths.map((p) => ({
        ...p,
        found: p.unresolved ? [] : L.findFiles([p.pattern], c).map((f) => ({
          file: f, sens: keyNow(f, draft.sens && draft.sens.name), fov: keyNow(f, draft.fov && draft.fov.name),
        })),
      }));
      if (!draft.sens) return { draft, files, match: null };

      const tryFiles = (list, source) => {
        const hits = [];
        for (const file of list) {
          let scan;
          try { scan = L.scanFile(file); } catch { continue; }
          if (scan.readOnly || !scan.keys.length) continue;
          const m = MS.matchKeys(draft, scan.keys);
          if (m) hits.push({ file, source, ...m });
        }
        // on a tie, prefer the user's settings over files inside the game's install folder (those are defaults)
        const inInstall = (f) => /[\\/]steamapps[\\/]common[\\/]/i.test(f);
        return hits.sort((a, b) => b.sens.score - a.sens.score || inInstall(a.file) - inInstall(b.file));
      };
      // 1) files the paste names, 2) otherwise search for the game by name
      let hits = tryFiles(files.flatMap((f) => f.found.map((x) => x.file)), 'paste');
      if (!hits.length) hits = tryFiles(L.discover(draft.name, c).files.map((f) => f.file), 'search');
      if (!hits.length) return { draft, files, match: null };

      const top = hits[0];
      // files the paste names: every copy with the same setting (e.g. single-player + multiplayer configs).
      // A name search only takes the best file, since it also turns up the game's own default files.
      const match = { ...top, files: top.source === 'paste' ? hits.filter((h) => h.sens.key === top.sens.key).map((h) => h.file) : [top.file] };
      if (draft.kind !== 'file') { draft.kind = 'file'; draft.summary = MS.summaryNotes(draft); }
      // the FOV SensSync would write with Match FOV on (in the game's own units), so it can be set before calibrating
      if (match.fov && draft.fovType && draft.fov) {
        const prefs = st.getPrefs();
        const probe = { id: '__import', fov: { type: draft.fovType, range: [draft.fov.min, draft.fov.max], decimals: draft.fov.decimals } };
        const v = E.computeValues(probe, { ...prefs, fov: { ...prefs.fov, enabled: true } });
        match.fovTarget = { value: v.fov, warning: v.warnings.find((w) => /FOV works out/.test(w)) || null };
      }
      return { draft, files, match };
    },
    adopt: (id) => {
      const g = game(id);
      const prefs = st.getPrefs();
      const cur = E.readCurrent(g, prefs, ctx);
      if (!cur || cur.cm360 == null) throw new Error("Couldn't read a sensitivity from this game.");
      const patch = { cm360: cur.cm360 };
      if (cur.fov != null && prefs.fov) patch.fov = { ...prefs.fov, enabled: true, value: cur.fov };
      st.setPrefs({ ...prefs, ...patch });
      return state();
    },
    chooseFile: (title) => (host.chooseFile ? host.chooseFile(title) : null),
    saveCustomGame: (input) => { E.saveCustomGame(input, st); return state(); },
    deleteCustomGame: (id) => { E.deleteCustomGame(id, st); return state(); },
    showFile: (p) => host.showFile && host.showFile(p),
    openExternal: (url) => { if (/^https:\/\//.test(url) && host.openExternal) host.openExternal(url); },
    // ---- shared game library ----
    refreshCommunity: () => C.refreshLibrary(st.communityFile, E.PRESETS, host.fetch || globalThis.fetch),
    // A game you added, made shareable: PC-specific paths become tokens, no calibration included.
    // Returns { ok, errors, profile, url } where url opens a prefilled GitHub issue for review.
    shareGame: (id, note) => {
      const g = game(id);
      if (!g.custom || g.builtin) throw new Error('Only games you added can be shared.');
      const c = fresh();
      const up = c.env.USERPROFILE || c.env.HOME || '';
      const roots = {
        steamLibs: L.steamLibraries(c), steamRoots: L.steamRoots(c), documents: L.documentsDirs(c),
        savedGames: up ? [path.join(up, 'Saved Games')] : [], env: c.env,
      };
      const r = C.shareableProfile(g, roots, { note, presets: E.PRESETS });
      return { ...r, url: r.ok ? C.shareUrl(r.profile) : null, repo: C.REPO };
    },
    installUpdate: () => (host.installUpdate ? host.installUpdate() : false),
    appVersion: () => (host.appVersion ? host.appVersion() : require('../package.json').version),
    openCalculator: () => (host.openCalculator ? host.openCalculator() : false),
    closeCalculator: () => (host.closeCalculator ? host.closeCalculator() : false),
    sideNav: (action) => (host.sideNav ? host.sideNav(String(action)) : false),
    watchClipboard: (on) => (host.watchClipboard ? host.watchClipboard(!!on) : false),
    yawFrom: (sens, dpi, cm) => M.yawFromMeasurement(Number(sens), Number(dpi), Number(cm)),
  };
}

module.exports = { makeHandlers };
