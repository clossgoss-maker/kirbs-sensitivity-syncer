#!/usr/bin/env node
'use strict';
// Command-line version (no Electron needed). Examples:
//   node cli.js list
//   node cli.js read                 (what each game is set to now, in cm/360)
//   node cli.js set --cm 34 --dpi 800 [--fov 103 --fov-type h169]
//   node cli.js preview apex
//   node cli.js apply apex
//   node cli.js apply all
//   node cli.js discover "the finals"
//   node cli.js restore apex
const path = require('path');
const os = require('os');
const E = require('./core/engine');
const L = require('./core/locate');

function dataDir() {
  if (process.env.SENSYNC_DATA) return process.env.SENSYNC_DATA;
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'sensync');
}

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const st = E.store(dataDir());
const ctx = L.makeContext();
let prefs = st.getPrefs();
const games = E.allGames(st);
const find = (id) => games.find((g) => g.id === id) || (console.error(`Unknown game "${id}". Try: node cli.js list`), process.exit(1));

function show(res) {
  const v = res.values;
  console.log(`  sensitivity: ${v.sens ?? '(needs setup)'}${v.source ? `  [${v.source}]` : ''}${v.fov != null ? `   fov: ${v.fov}` : ''}`);
  v.warnings.forEach((w) => console.log(`  ! ${w}`));
  (res.errors || []).forEach((w) => console.log(`  ✗ ${w}`));
  (res.edits || []).forEach((e) => {
    console.log(`  ${e.written ? '✓ wrote' : '→'} ${e.file}`);
    e.changes.forEach((c) => console.log(`      ${c.key}: ${c.from ?? '(new)'} → ${c.to}`));
    if (e.error) console.log(`      ✗ ${e.error}`);
  });
  if (res.backup) console.log(`  backup: ${res.backup}`);
}

switch (cmd) {
  case 'set': {
    if (opt('cm')) prefs.cm360 = Number(opt('cm'));
    if (opt('dpi')) prefs.dpi = Number(opt('dpi'));
    if (opt('fov')) prefs.fov = { enabled: true, value: Number(opt('fov')), type: opt('fov-type') || prefs.fov.type || 'h169' };
    if (args.includes('--no-fov')) prefs.fov.enabled = false;
    st.setPrefs(prefs);
    console.log(`Saved: ${prefs.cm360} cm/360 @ ${prefs.dpi} DPI${prefs.fov.enabled ? `, FOV ${prefs.fov.value} (${prefs.fov.type})` : ''}`);
    break;
  }
  case 'list': {
    console.log(`Target: ${prefs.cm360} cm/360 @ ${prefs.dpi} DPI\n`);
    for (const g of games) {
      const s = E.status(g, prefs, ctx);
      const tag = g.apply === 'manual' ? 'type in-game' : s.found ? 'config found' : 'not found';
      console.log(`${g.id.padEnd(12)} ${g.name.padEnd(26)} ${tag.padEnd(13)} sens=${s.values.sens ?? '-'}${s.values.fov != null ? ` fov=${s.values.fov}` : ''}`);
    }
    break;
  }
  case 'preview':
  case 'apply': {
    const ids = args[1] === 'all' ? games.filter((g) => g.apply === 'file').map((g) => g.id) : [args[1]];
    for (const id of ids) {
      const g = find(id);
      console.log(`\n${g.name}`);
      show(cmd === 'apply' ? E.apply(g, prefs, ctx, st, { force: args.includes('--force') }) : E.plan(g, prefs, ctx));
    }
    break;
  }
  case 'read': {
    // What is each game set to right now, in cm/360?
    console.log(`Reading current settings (DPI ${prefs.dpi})\n`);
    for (const g of games) {
      const c = E.readCurrent(g, prefs, ctx);
      if (!c) continue;
      if (c.error) { console.log(`${g.name.padEnd(26)} ${c.error}`); continue; }
      console.log(`${g.name.padEnd(26)} sens ${String(c.sens).padEnd(10)} ${c.cm360 != null ? `${c.cm360} cm/360` : c.note}${c.fovRaw != null ? `   FOV ${c.fovRaw}` : ''}`);
    }
    break;
  }
  case 'calibrate': {
    // node cli.js calibrate <id> --sens 2.5 --cm 34 [--dpi 800]
    const g = find(args[1]);
    prefs.games[g.id] = { ...(prefs.games[g.id] || {}), calibration: { sens: Number(opt('sens')), cm360: Number(opt('cm') || prefs.cm360), dpi: Number(opt('dpi') || prefs.dpi) }, manualSens: null };
    st.setPrefs(prefs);
    console.log(`Calibrated ${g.name}: yaw = ${E.effectiveYaw(g, prefs.games[g.id])}`);
    break;
  }
  case 'discover': {
    const r = L.discover(args.slice(1).join(' '), ctx);
    console.log(`Searched ${r.searched.length} folder(s).`);
    r.files.forEach((f) => {
      console.log(`\n${f.file}`);
      f.keys.slice(0, 6).forEach((k) => console.log(`   ${k.kind.padEnd(4)} ${k.section ? `[${k.section}] ` : ''}${k.key} = ${k.value}`));
    });
    if (!r.files.length) console.log('Nothing found. Launch the game once, change a setting and quit, then try again.');
    break;
  }
  case 'restore': {
    const r = E.restore(args[1], st);
    console.log(`Restored from ${r.from}:\n  ${r.restored.join('\n  ')}`);
    break;
  }
  default:
    console.log('Usage: node cli.js list | read | set --cm N --dpi N [--fov N --fov-type h169|h43|v] | preview <id|all> | apply <id|all> | calibrate <id> --sens S --cm C | discover <name> | restore <id>');
}
