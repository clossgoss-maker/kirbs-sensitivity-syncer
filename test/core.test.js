'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../core/math');
const Ed = require('../core/editor');
const L = require('../core/locate');
const E = require('../core/engine');

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('math: known cm/360 values', () => {
  near(M.cmFromSens(1, 800, 0.022), 51.9545, 1e-3);      // CS 800dpi sens 1
  near(M.sensFromCm(51.9545, 800, 0.022), 1, 1e-4);
  near(M.sensFromCm(34.64, 800, 0.07), 0.4714, 1e-3);    // Valorant 0.4714 ≈ CS 1.5
  near(M.yawFromMeasurement(1, 800, 51.9545), 0.022, 1e-6);
});

test('math: FOV conversions', () => {
  near(M.convertFov(103, 'h169', 'v'), 70.53, 0.01);     // OW 103 = 70.53 vertical
  near(M.convertFov(90, 'h43', 'h169'), 106.26, 0.01);   // Source 90 = 106.26 at 16:9
  near(M.fovToConfigValue(110, { kind: 'linear', fov: [70, 110], value: [1, 1.55] }), 1.55);
});

test('editor: keeps formats intact', () => {
  const vcfg = '"config"\r\n{\r\n\t"convars"\r\n\t{\r\n\t\t"sensitivity"\t\t"1.250000"\r\n\t\t"sensitivity_y_scale"\t\t"1"\r\n\t}\r\n}\r\n';
  const r = Ed.setKey(vcfg, 'sensitivity', 0.88);
  assert.match(r.text, /"sensitivity"\t\t"0\.88"\r\n/);
  assert.match(r.text, /"sensitivity_y_scale"\t\t"1"/);
  assert.strictEqual(r.changed.length, 1);

  const ini = '﻿[INPUT]\nMouseYawSensitivity=10\nMouseSensitivityMultiplierUnit=0.020000\n[DISPLAY]\nDefaultFOV=60.000000\n';
  const r2 = Ed.setKey(ini, 'DefaultFOV', 70.53, { decimals: 4 });
  assert.ok(r2.text.startsWith('﻿'));
  assert.match(r2.text, /DefaultFOV=70\.53\n/);

  const src = 'bind "w" "+forward"\nsensitivity "3"\nfov_desired 75\n';
  let r3 = Ed.setKey(src, 'fov_desired', 90, { decimals: 0 });
  assert.match(r3.text, /fov_desired 90\n/);
  r3 = Ed.setKey(r3.text, 'm_yaw', 0.022, { insert: 'source' });
  assert.match(r3.text, /m_yaw "0\.022"\n$/);

  const json = '{\n  "Mouse": {\n    "LookSensitivity": 0.5,\n    "FieldOfView": 90\n  }\n}';
  assert.match(Ed.setKey(json, 'LookSensitivity', 0.31).text, /"LookSensitivity": 0\.31,/);

  const quake = 'bind W "+forward"\nseta sensitivity "5"\n';
  assert.deepStrictEqual(Ed.findKey(quake, 'sensitivity').map((h) => h.value), [5]);
  assert.match(Ed.setKey(quake, 'sensitivity', 2.5).text, /^seta sensitivity "2\.5"$/m);

  const xml = '<Settings><MouseSensitivity>12</MouseSensitivity></Settings>';
  assert.match(Ed.setKey(xml, 'MouseSensitivity', 7.5).text, /<MouseSensitivity>7\.5<\/MouseSensitivity>/);
});

test('editor: scan ranks sensitivity/fov keys', () => {
  const ini = '[/Script/Game.Settings]\nMouseSensitivity=0.45\nGamepadSensitivity=1.0\nFieldOfView=90\nResolutionX=1920\n';
  const keys = Ed.scanNumericKeys(ini);
  assert.strictEqual(keys[0].key, 'MouseSensitivity');
  assert.ok(keys.find((k) => k.key === 'FieldOfView' && k.kind === 'fov'));
  assert.ok(keys.find((k) => k.key === 'ResolutionX' && !k.kind));
});

const { fakeMachine } = require('./fixtures');

test('locate: steam libraries, wildcards, tokens', () => {
  const m = fakeMachine();
  assert.strictEqual(L.steamLibraries(m.ctx).length, 2);
  const cs = L.findFiles(['{STEAM}/userdata/*/730/local/cfg/cs2_user_convars_0_slot0.vcfg'], m.ctx);
  assert.strictEqual(cs.length, 1);
  const tf = L.findFiles(['{STEAMLIB}/steamapps/common/Team Fortress 2/tf/cfg/config.cfg'], m.ctx);
  assert.strictEqual(tf.length, 1);
  const r6 = L.findFiles(['{DOCUMENTS}/My Games/Rainbow Six - Siege/*/GameSettings.ini'], m.ctx);
  assert.strictEqual(r6.length, 1);
});

test('engine: built-in games end-to-end', () => {
  const m = fakeMachine();
  const prefs = { ...m.st.getPrefs(), cm360: 34.6, dpi: 800, fov: { enabled: true, value: 103, type: 'h169' }, aspect: 16 / 9 };
  const games = E.allGames(m.st);
  const g = (id) => games.find((x) => x.id === id);

  const cs = E.apply(g('cs2'), prefs, m.ctx, m.st);
  assert.ok(cs.applied, JSON.stringify(cs.errors));
  const csText = fs.readFileSync(cs.edits[0].file, 'utf8');
  near(parseFloat(/"sensitivity"\t\t"([\d.]+)"/.exec(csText)[1]), M.sensFromCm(34.6, 800, 0.022), 1e-5);

  const apex = E.apply(g('apex'), prefs, m.ctx, m.st);
  assert.ok(apex.applied);
  assert.strictEqual(apex.edits.length, 2);
  const prof = fs.readFileSync(path.join(m.home, 'Saved Games/Respawn/Apex/profile/profile.cfg'), 'utf8');
  near(parseFloat(/cl_fovScale "([\d.]+)"/.exec(prof)[1]), 1 + (M.convertFov(103, 'h169', 'h43') - 70) * 0.01375, 1e-4);

  const tf = E.apply(g('tf2'), prefs, m.ctx, m.st);
  assert.ok(tf.applied);
  assert.match(fs.readFileSync(tf.edits[0].file, 'utf8'), /fov_desired "87"/); // 103 @16:9 = 86.6 @4:3
  const wide = E.computeValues(g('tf2'), { ...prefs, fov: { enabled: true, value: 120, type: 'h169' } });
  assert.ok(wide.warnings.some((w) => /only allows 75 to 90/.test(w)));
  assert.strictEqual(wide.fov, 90);

  // Siege: sliders forced to 50, sensitivity goes into the multiplier
  const r6 = E.apply(g('r6siege'), prefs, m.ctx, m.st);
  assert.ok(r6.applied, JSON.stringify(r6.errors));
  const r6t = fs.readFileSync(r6.edits[0].file, 'utf8');
  const mult = parseFloat(/MouseSensitivityMultiplierUnit=([\d.]+)\r\n/.exec(r6t)[1]);
  near(mult * 50 / 0.02, M.sensFromCm(34.6, 800, 0.00572958), 1e-3); // = Siege slider value at default multiplier
  assert.match(r6t, /MouseYawSensitivity=50\r\n/);
  assert.match(r6t, /DefaultFOV=70\.53/);

  // Valorant: calculate only
  const val = E.plan(g('valorant'), prefs, m.ctx);
  assert.ok(val.manual);
  near(val.values.sens, 0.4719, 1e-3);

  // restore
  const before = fs.readFileSync(cs.edits[0].file, 'utf8');
  E.restore('cs2', m.st);
  assert.match(fs.readFileSync(cs.edits[0].file, 'utf8'), /"2\.000000"/);
  assert.notStrictEqual(before, fs.readFileSync(cs.edits[0].file, 'utf8'));
});

test('engine: any game via discovery + custom profile + calibration', () => {
  const m = fakeMachine();
  const d = L.discover('The Finals', m.ctx); // folder is "Discovery" — name won't match
  assert.strictEqual(d.files.length, 0);
  const d2 = L.discover('neon runner', m.ctx);
  assert.strictEqual(d2.files.length, 1);
  const hit = d2.files[0];
  assert.strictEqual(hit.keys[0].key, 'MouseLookSensitivity');
  const fovKey = hit.keys.find((k) => k.kind === 'fov');
  assert.strictEqual(fovKey.key, 'FOV');

  const game = E.saveCustomGame({ name: 'Neon Runner', sensFile: hit.file, sensKey: 'MouseLookSensitivity', fovFile: hit.file, fovKey: 'FOV', fovType: 'h169' }, m.st);
  const prefs = { ...m.st.getPrefs(), cm360: 30, dpi: 1600, fov: { enabled: true, value: 103, type: 'h169' } };
  // "with sens 1.0 at 1600 dpi I measured 40 cm/360"
  prefs.games[game.id] = { calibration: { sens: 1.0, cm360: 40, dpi: 1600 } };
  const g = E.allGames(m.st).find((x) => x.id === 'neon-runner');
  const r = E.apply(g, prefs, m.ctx, m.st);
  assert.ok(r.applied, JSON.stringify(r));
  const t = fs.readFileSync(hit.file, 'utf8');
  assert.match(t, /MouseLookSensitivity=1\.333333\n/); // 40/30
  assert.match(t, /ControllerSensitivity=0\.7\n/);     // untouched
  assert.match(t, /FOV=103\.0?\n/);
});

test('pending changes: out of sync before Apply, in sync after', () => {
  const m = fakeMachine();
  const prefs = { ...m.st.getPrefs(), cm360: 34.6, dpi: 800, fov: { enabled: true, value: 103, type: 'h169' }, aspect: 16 / 9 };
  const g = (id) => E.allGames(m.st).find((x) => x.id === id);

  const before = E.pendingChanges(g('tf2'), prefs, m.ctx);
  assert.ok(before.some((p) => p.key === 'sensitivity'), JSON.stringify(before));
  assert.ok(before.some((p) => p.key === 'fov_desired'), JSON.stringify(before));
  assert.ok(E.apply(g('tf2'), prefs, m.ctx, m.st).applied);
  assert.deepStrictEqual(E.pendingChanges(g('tf2'), prefs, m.ctx), []);

  // only the FOV target changes -> only FOV is pending
  const wider = { ...prefs, fov: { ...prefs.fov, value: 106.26 } }; // = 90 at 4:3
  assert.deepStrictEqual(E.pendingChanges(g('tf2'), wider, m.ctx).map((p) => p.key).sort(), ['fov_desired']);

  // Siege also counts its slider keys, and manual games have nothing to apply
  assert.ok(E.apply(g('r6siege'), prefs, m.ctx, m.st).applied);
  assert.deepStrictEqual(E.pendingChanges(g('r6siege'), prefs, m.ctx), []);
  assert.strictEqual(E.pendingChanges(g('valorant'), prefs, m.ctx), null);
  assert.strictEqual(E.status(g('tf2'), prefs, m.ctx).pending.length, 0);
});

test('engine presets: valid, match built-ins, and drive a custom game', () => {
  const ids = new Set();
  for (const p of E.PRESETS) {
    assert.ok(p.id && p.name && p.examples, JSON.stringify(p));
    assert.ok(!ids.has(p.id), `duplicate preset ${p.id}`); ids.add(p.id);
    assert.ok(p.yaw > 0 && p.yaw < 1, `${p.id} yaw ${p.yaw}`);
    if (p.fovType) assert.ok(['h169', 'h43', 'v', 'hnative'].includes(p.fovType), p.fovType);
  }
  const preset = (id) => E.PRESETS.find((p) => p.id === id);
  const builtin = (id) => E.BUILTIN.find((g) => g.id === id);
  assert.strictEqual(preset('source').yaw, builtin('cs2').yaw);
  assert.strictEqual(preset('overwatch').yaw, builtin('ow2').yaw);
  assert.strictEqual(preset('valorant').yaw, builtin('valorant').yaw);

  // A custom game saved with a preset's yaw gets the same number as the built-in game
  const m = fakeMachine();
  const d = L.discover('neon runner', m.ctx);
  const game = E.saveCustomGame({ name: 'Neon Runner', sensFile: d.files[0].file, sensKey: 'MouseLookSensitivity', yaw: preset('source').yaw }, m.st);
  const prefs = { ...m.st.getPrefs(), cm360: 34.6, dpi: 800 };
  near(E.computeValues(game, prefs).sens, M.sensFromCm(34.6, 800, 0.022), 1e-6);
});

// ---------- mouse-sensitivity.com paste import ----------
const MS = require('../core/msimport');
const SAMPLES = path.join(__dirname, 'import-samples');

// expected files list only the fields that matter; arrays must match in length
function assertSubset(actual, expected, where) {
  if (expected === null || typeof expected !== 'object') return assert.deepStrictEqual(actual, expected, where);
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${where}: expected an array`);
    assert.strictEqual(actual.length, expected.length, `${where}: length ${JSON.stringify(actual)}`);
    return expected.forEach((e, i) => assertSubset(actual[i], e, `${where}[${i}]`));
  }
  assert.ok(actual && typeof actual === 'object', `${where}: expected an object, got ${JSON.stringify(actual)}`);
  for (const k of Object.keys(expected)) assertSubset(actual[k], expected[k], `${where}.${k}`);
}

for (const f of fs.readdirSync(SAMPLES).filter((n) => n.endsWith('.txt'))) {
  test(`import sample: ${f}`, () => {
    const draft = MS.parse(fs.readFileSync(path.join(SAMPLES, f), 'utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(SAMPLES, f.replace(/\.txt$/, '.expected.json')), 'utf8'));
    assertSubset(draft, expected, f);
  });
}

test('import: odd pastes degrade instead of failing', () => {
  const d = MS.parse('Some Game - Hipfire\nSensitivity 1:\nsomething we have never seen\nEngine: Mystery Engine\n');
  assert.strictEqual(d.name, 'Some Game');
  assert.strictEqual(d.engine, 'Mystery Engine');
  assert.strictEqual(d.sens, null);
  assert.deepStrictEqual(d.unknown.map((u) => u.line), ['something we have never seen']);
  assert.ok(d.checks.some((c) => /No sensitivity/.test(c)));
  assert.doesNotThrow(() => MS.parse(''));
  // a known engine name suggests the matching preset
  assert.strictEqual(MS.parse('X - All\nEngine:\nSource\n').preset, 'source');
});

test('import: CoD4 end to end (find file, seta keys, save, apply)', () => {
  const m = fakeMachine();
  const cfg = path.join(m.lib2, 'steamapps', 'common', 'Call of Duty 4', 'players2', 'config_mp.cfg');
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, 'unbindall\nbind W "+forward"\nseta 0xBC3E3CAE "5"\nseta 0x8572B2C7 "65"\n');

  const d = MS.parse(fs.readFileSync(path.join(SAMPLES, 'cod4.txt'), 'utf8'));
  const found = d.paths.flatMap((p) => L.findFiles([p.pattern], m.ctx));
  assert.deepStrictEqual(found, [fs.realpathSync.native(cfg)]); // single-player config doesn't exist here
  const scanned = L.scanFile(cfg).keys.map((k) => k.key);
  assert.ok(scanned.includes('0xBC3E3CAE') && scanned.includes('0x8572B2C7'), scanned.join());

  const game = E.saveCustomGame({
    name: d.name, sensFiles: found, sensKey: d.sens.name, fovKey: d.fov.name, fovType: d.fovType,
    sensRange: [d.sens.min, d.sens.max], fovRange: [d.fov.min, d.fov.max], fovDecimals: d.fov.decimals, yaw: 0.022,
  }, m.st);
  const prefs = { ...m.st.getPrefs(), cm360: 34.6, dpi: 800, fov: { enabled: true, value: 103, type: 'h169' }, aspect: 16 / 9 };
  const r = E.apply(E.allGames(m.st).find((g) => g.id === game.id), prefs, m.ctx, m.st);
  assert.ok(r.applied, JSON.stringify(r));
  const t = fs.readFileSync(cfg, 'utf8');
  near(parseFloat(/seta 0xBC3E3CAE "([\d.]+)"/.exec(t)[1]), M.sensFromCm(34.6, 800, 0.022), 1e-5);
  assert.match(t, /seta 0x8572B2C7 "87"/); // 103 @16:9 = 86.6 @4:3, game uses whole numbers
  assert.match(t, /bind W "\+forward"/);
});

// Rebuilt from what an earlier import saved, not a verbatim copy of the site's box
const CYBERPUNK_PASTE = `Cyberpunk 2077 - Hipfire
Location
In-game:
Settings -> Controls -> First-Person Camera (Mouse)
Sensitivity
(Minimum | Default | Maximum)
Sensitivity 1:
First-Person Camera (Mouse) - Horizontal Sensitivity 1 | 5 | 30
Multiplier 1:
Additional Zoom 0 | 0 | 1
FOV:
Field of View 70 | 80 | 130
FOV Type:
Horizontal Degrees (16:9 Base)`;

test('editor: named JSON settings (Cyberpunk UserSettings.json)', () => {
  const m = fakeMachine();
  const file = path.join(m.home, 'AppData', 'Local', 'CD Projekt Red', 'Cyberpunk 2077', 'UserSettings.json');
  const text = fs.readFileSync(file, 'utf8');
  assert.deepStrictEqual(Ed.findKey(text, 'FPP_MouseX').map((h) => h.value), [4]);
  const r = Ed.setKey(text, 'FPP_MouseX', 3.25);
  assert.strictEqual(r.changed.length, 1);
  assert.match(r.text, /"name": "FPP_MouseX",\r\n\s+"type": "float",\r\n\s+"value": 3\.25,\r\n\s+"default_value": 5\.0,/);
  assert.match(r.text, /"name": "FPP_MouseY",\r\n\s+"type": "float",\r\n\s+"value": 4\.0,/); // untouched
  const keys = Ed.scanNumericKeys(text);
  const x = keys.find((k) => k.key === 'FPP_MouseX');
  assert.deepStrictEqual([x.value, x.min, x.def, x.max, x.kind], [4, 1, 5, 30, 'sens']);
  assert.ok(!keys.some((k) => /^(value|default_value|min_value|max_value|step_value)$/.test(k.key)), keys.map((k) => k.key).join());
});

test('import: in-game paste finds the config by searching, then calibrates and applies', () => {
  const m = fakeMachine();
  const { makeHandlers } = require('../app/handlers');
  const h = makeHandlers(m.st, () => L.makeContext({ env: m.env, platform: 'linux' }));
  const res = h.importText(CYBERPUNK_PASTE);
  const userFile = path.join(m.home, 'AppData', 'Local', 'CD Projekt Red', 'Cyberpunk 2077', 'UserSettings.json');
  assert.ok(res.match, 'should find the config');
  assert.strictEqual(res.match.source, 'search');
  assert.deepStrictEqual(res.match.files, [userFile]); // not the install folder's defaults file
  assert.strictEqual(res.match.sens.key, 'FPP_MouseX');
  assert.strictEqual(res.match.sens.value, 4);
  assert.deepStrictEqual(res.match.sensAlso.map((k) => k.key), ['FPP_MouseY']);
  assert.strictEqual(res.match.fov.key, 'FieldOfView');
  assert.strictEqual(res.draft.kind, 'file');
  assert.doesNotMatch(res.draft.summary, /Set in-game/);

  // what "Calibrate and apply" does: site says 3.2 for the target
  const d = res.draft, mt = res.match;
  const game = E.saveCustomGame({ name: d.name, sensFiles: mt.files, sensKeys: [mt.sens.key, ...mt.sensAlso.map((k) => k.key)], sensRange: [d.sens.min, d.sens.max], fovKey: mt.fov.key, fovType: d.fovType, fovRange: [d.fov.min, d.fov.max], fovDecimals: d.fov.decimals }, m.st);
  h.setGamePrefs(game.id, { calibration: { sens: 3.2, cm360: 30, dpi: 850 } });
  h.savePrefs({ cm360: 30, dpi: 850, fov: { enabled: true, value: 103, type: 'h169' } });
  const st = h.state().games.find((g) => g.id === game.id);
  assert.strictEqual(st.values.sens, 3.2);
  near(st.current.cm360, 30 * 3.2 / 4, 0.01); // current 4 = 24 cm/360
  const r = h.apply(game.id, false);
  assert.ok(r.applied, JSON.stringify(r));
  const t = fs.readFileSync(userFile, 'utf8');
  assert.match(t, /"name": "FPP_MouseX",\r\n\s+"type": "float",\r\n\s+"value": 3\.2,/);
  assert.match(t, /"name": "FPP_MouseY",\r\n\s+"type": "float",\r\n\s+"value": 3\.2,/);
  assert.match(t, /"name": "TPP_MouseX",\r\n\s+"type": "float",\r\n\s+"value": 3\.0,/);
  assert.match(t, /"name": "FieldOfView",\r\n\s+"type": "float",\r\n\s+"value": 103,/);
  assert.match(t, /"default_value": 5\.0,/);
  assert.deepStrictEqual(h.state().games.find((g) => g.id === game.id).pending, []);
});

test('FOV first: per-game FOV choice, calibration FOV, warning when FOV moves', () => {
  const m = fakeMachine();
  const d = MS.parse(fs.readFileSync(path.join(SAMPLES, 'cod4.txt'), 'utf8'));
  assert.strictEqual(d.fovAffectsSens, true);
  assert.match(d.summary, /recalibrate if you change its FOV/);
  const game = E.saveCustomGame({ name: 'FovGame', sensFile: path.join(m.lib2, 'steamapps', 'common', 'Call of Duty 4', 'players2', 'config_mp.cfg'), sensKey: '0xBC3E3CAE', fovKey: '0x8572B2C7', fovType: 'h43', fovRange: [65, 90], fovDecimals: 0, fovAffectsSens: d.fovAffectsSens }, m.st);
  assert.strictEqual(game.fovAffectsSens, true);
  const base = { ...m.st.getPrefs(), cm360: 30, dpi: 800, aspect: 16 / 9, fov: { enabled: false, value: 103, type: 'h169' } };
  const cal = { sens: 2, cm360: 30, dpi: 800, fov: 87 };

  // Match FOV off, but this game set to match: FOV written, same as calibration -> no warning
  let v = E.computeValues(game, { ...base, games: { [game.id]: { calibration: cal, fovMatch: true } } });
  assert.strictEqual(v.fov, 87);
  assert.ok(!v.warnings.some((w) => /calibrated at FOV/.test(w)), v.warnings.join());
  // target FOV changes -> warning, because FOV affects this game's sensitivity
  v = E.computeValues(game, { ...base, fov: { ...base.fov, value: 90 }, games: { [game.id]: { calibration: cal, fovMatch: true } } });
  assert.ok(v.warnings.some((w) => /calibrated at FOV 87/.test(w)), v.warnings.join());
  // keep FOV: nothing written even with Match FOV on, no warning
  v = E.computeValues(game, { ...base, fov: { ...base.fov, enabled: true }, games: { [game.id]: { calibration: cal, keepFov: true } } });
  assert.strictEqual(v.fov, null);
  assert.ok(!v.warnings.some((w) => /calibrated at FOV/.test(w)));
  // games without the flag never warn
  const plain = { ...game, fovAffectsSens: undefined };
  v = E.computeValues(plain, { ...base, fov: { ...base.fov, value: 90 }, games: { [game.id]: { calibration: cal, fovMatch: true } } });
  assert.ok(!v.warnings.some((w) => /calibrated at FOV/.test(w)));
  // FOV after apply: written value, else what's in the config now
  assert.strictEqual(E.fovAfterApply(game, { ...base, games: { [game.id]: { fovMatch: true } } }, { fovRaw: 65 }), 87);
  assert.strictEqual(E.fovAfterApply(game, base, { fovRaw: 65 }), 65);
});

// ---------- shared game library ----------
const C = require('../core/community');

test('community: only safe, setup-only profiles are accepted', () => {
  const good = {
    id: 'neon-runner', name: 'Neon Runner', apply: 'file',
    files: { sens: { paths: ['%LOCALAPPDATA%/NeonRunner/Saved/Config/Windows/GameUserSettings.ini'] } },
    sens: { file: 'sens', keys: ['MouseLookSensitivity'], range: [0.1, 10] }, fov: null,
  };
  const v = C.validateProfile(good, E.PRESETS);
  assert.ok(v.ok, v.errors.join());
  assert.ok(!('yaw' in v.profile));
  const bad = (patch) => C.validateProfile({ ...good, ...patch }, E.PRESETS);
  assert.ok(!bad({ files: { sens: { paths: ['C:/Windows/System32/drivers/etc/hosts'] } } }).ok); // absolute path
  assert.ok(!bad({ files: { sens: { paths: ['%LOCALAPPDATA%/../../evil.ini'] } } }).ok); // escaping the root
  assert.ok(!bad({ files: { sens: { paths: ['%LOCALAPPDATA%/Game/run.exe'] } } }).ok); // not a config file
  assert.ok(!bad({ id: 'Bad ID!' }).ok);
  assert.ok(!bad({ sens: { file: 'sens', keys: ['x"; rm -rf'] } }).ok);
  // a yaw is never taken from a profile; only a known engine preset sets one
  const withYaw = C.validateProfile({ ...good, yaw: 0.0123 }, E.PRESETS);
  assert.ok(withYaw.ok && !('yaw' in withYaw.profile));
  const preset = C.validateProfile({ ...good, preset: 'source' }, E.PRESETS);
  assert.strictEqual(preset.profile.yaw, 0.022);
  assert.ok(!C.validateProfile({ ...good, preset: 'nope' }, E.PRESETS).ok);
});

test('community: sharing turns PC paths into tokens and leaves calibration out', () => {
  const m = fakeMachine();
  const { makeHandlers } = require('../app/handlers');
  const h = makeHandlers(m.st, () => L.makeContext({ env: m.env, platform: 'linux' }));
  const cs = path.join(m.steam, 'userdata', '12345', '730', 'local', 'cfg', 'cs2_user_convars_0_slot0.vcfg');
  const tf = path.join(m.lib2, 'steamapps', 'common', 'Team Fortress 2', 'tf', 'cfg', 'config.cfg');
  const cp = path.join(m.home, 'AppData', 'Local', 'CD Projekt Red', 'Cyberpunk 2077', 'UserSettings.json');
  E.saveCustomGame({ name: 'Multi Path', sensFiles: [cs, tf, cp], sensKey: 'sensitivity', yaw: 0.0123 }, m.st);
  h.setGamePrefs('multi-path', { calibration: { sens: 2, cm360: 30, dpi: 800 } });
  const r = h.shareGame('multi-path', 'Close the game first.');
  assert.ok(r.ok, r.errors.join());
  assert.deepStrictEqual(r.profile.files.sens.paths, [
    '{STEAM}/userdata/*/730/local/cfg/cs2_user_convars_0_slot0.vcfg', // Steam account ID removed
    '{STEAMLIB}/steamapps/common/Team Fortress 2/tf/cfg/config.cfg',
    '%LOCALAPPDATA%/CD Projekt Red/Cyberpunk 2077/UserSettings.json',
  ]);
  const json = JSON.stringify(r.profile);
  assert.ok(!json.includes(m.root.replace(/\\/g, '/')) && !json.includes(fs.realpathSync.native(m.root).replace(/\\/g, '/')) && !json.includes('12345'), json);
  assert.ok(!('yaw' in r.profile) && !('calibration' in r.profile)); // calibrated yaw isn't shared
  assert.strictEqual(r.profile.notes, 'Close the game first.');
  // paths outside the known places can't be shared
  E.saveCustomGame({ name: 'Odd Place', sensFile: path.join(m.root, 'Games', 'odd.ini'), sensKey: 's' }, m.st);
  assert.ok(!h.shareGame('odd-place').ok);
  assert.throws(() => h.shareGame('cs2'), /Only games you added/);
});

test('community: library games show up, your own games override them', () => {
  const m = fakeMachine();
  const cache = m.st.communityFile;
  fs.writeFileSync(cache, JSON.stringify({ games: [
    { id: 'shared-one', name: 'Shared One', apply: 'manual', files: {}, sens: { range: [1, 10] }, preset: 'overwatch' },
    { id: 'evil', name: 'Evil', apply: 'file', files: { sens: { paths: ['C:/Windows/win.ini'] } }, sens: { file: 'sens', keys: ['x'] } },
    { id: 'cs2', name: 'Not CS2', apply: 'manual', files: {}, sens: {} },
  ] }));
  const games = E.allGames(m.st);
  const shared = games.find((g) => g.id === 'shared-one');
  assert.ok(shared && shared.community && shared.yaw === 0.0066);
  assert.ok(!games.some((g) => g.id === 'evil')); // invalid entries are dropped
  assert.strictEqual(games.find((g) => g.id === 'cs2').name, 'Counter-Strike 2'); // built-ins can't be replaced
  E.saveCustomGame({ id: 'shared-one', name: 'Mine', manual: true }, m.st);
  const mine = E.allGames(m.st).find((g) => g.id === 'shared-one');
  assert.ok(mine.custom && !mine.community && mine.name === 'Mine');
});

test('community: the repo library is valid and up to date', () => {
  const { build, OUT } = require('../scripts/build-community');
  const lib = build();
  assert.deepStrictEqual(lib.problems, []);
  assert.strictEqual(fs.readFileSync(OUT, 'utf8').replace(/\r/g, ''), lib.text);
  const { profileFromIssueBody } = require('../scripts/community-from-issue');
  assert.deepStrictEqual(profileFromIssueBody('### Game profile\n\n```json\n{"id":"x"}\n```\n\n### Anything else?\n\n_No response_'), { id: 'x' });
});

test('clipboard: recognises copied Game Info boxes and result numbers only', () => {
  for (const f of fs.readdirSync(SAMPLES).filter((n) => n.endsWith('.txt'))) {
    assert.strictEqual(MS.classifyClipboard(fs.readFileSync(path.join(SAMPLES, f), 'utf8')).kind, 'gameinfo', f);
  }
  assert.strictEqual(MS.classifyClipboard(CYBERPUNK_PASTE).kind, 'gameinfo');
  assert.deepStrictEqual(MS.classifyClipboard(' 3.2 \n'), { kind: 'number', value: 3.2, text: '3.2' });
  assert.strictEqual(MS.classifyClipboard('0,4719').value, 0.4719);
  assert.strictEqual(MS.classifyClipboard('.5').value, 0.5);
  for (const no of ['', '0', '-1', 'hello', '3.2 cm', '1920x1080', 'https://x.com', 'My Game - Hipfire\nsome text', 'a\nb\nc\nd']) {
    assert.strictEqual(MS.classifyClipboard(no), null, JSON.stringify(no));
  }
});

test('custom in-game games: no file, value to type, range warnings', () => {
  const m = fakeMachine();
  const d = MS.parse(fs.readFileSync(path.join(SAMPLES, 'halo-infinite.txt'), 'utf8'));
  const game = E.saveCustomGame({ name: d.name, manual: true, sensRange: [d.sens.min, d.sens.max], sensDecimals: 2, notes: d.summary }, m.st);
  assert.strictEqual(game.apply, 'manual');
  assert.deepStrictEqual(game.files, {});
  const prefs = { ...m.st.getPrefs(), cm360: 30, dpi: 800, games: { [game.id]: { calibration: { sens: 1, cm360: 30, dpi: 800 } } } };
  const v = E.computeValues(game, prefs);
  assert.strictEqual(v.sens, 1);
  const far = E.computeValues(game, { ...prefs, cm360: 10 });
  assert.ok(far.warnings.some((w) => /outside what the game allows/.test(w)));
  assert.match(game.notes, /Keep "Mouse Sensitivity" at the value you used/);
});

test('read current settings -> cm/360 (incl. binary .sav)', () => {
  const m = fakeMachine();
  const prefs = { ...m.st.getPrefs(), dpi: 850, fov: { enabled: true, value: 103, type: 'h169' } };
  const games = E.allGames(m.st);
  const g = (id) => games.find((x) => x.id === id);

  const tf = E.readCurrent(g('thefinals'), prefs, m.ctx);
  assert.strictEqual(tf.sens, 37);
  near(tf.cm360, 914.4 / (850 * 37 * 0.001), 0.01); // 29.08
  assert.strictEqual(tf.fovRaw, 100);

  const cs = E.readCurrent(g('cs2'), prefs, m.ctx);
  near(cs.cm360, M.cmFromSens(2, 850, 0.022), 0.01);

  const apex = E.readCurrent(g('apex'), prefs, m.ctx);
  assert.strictEqual(apex.sens, 2.5);
  near(apex.fov, M.convertFov(70, 'h43', 'h169'), 0.1); // cl_fovScale 1.0 = 70 @4:3

  const r6 = E.readCurrent(g('r6siege'), prefs, m.ctx); // slider 12, multiplier 0.02
  near(r6.cm360, M.cmFromSens(12, 850, 0.00572958), 0.05);

  assert.strictEqual(E.readCurrent(g('valorant'), prefs, m.ctx), null);

  // discovery finds the .sav and marks it read-only
  const d = L.discover('Discovery', m.ctx);
  const hit = d.files.find((f) => f.file.endsWith('.sav'));
  assert.ok(hit && hit.readOnly);
  assert.strictEqual(hit.keys[0].key, 'GameplayOption.Controls.MouseSensitivity');
});
