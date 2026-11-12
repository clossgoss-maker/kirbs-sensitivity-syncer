'use strict';
// Reads the "Game Info" box a user copies from mouse-sensitivity.com and turns it into a draft
// game profile for the Add a game form. It never saves anything itself: the user checks the draft.
// What it understands is driven by import-rules.json, so new wording is a rules change, not a code change.
const fs = require('fs');
const path = require('path');

const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, 'import-rules.json'), 'utf8'));

const rx = (s) => new RegExp(s, 'i');
const decimalsOf = (...strs) => Math.max(0, ...strs.map((s) => (String(s).split('.')[1] || '').length));

function compile(rules) {
  return {
    sections: rules.sections.map((s) => ({ id: s.id, re: rx(s.match) })),
    skip: rules.skipLines.map(rx),
    formats: rules.valueFormats.map((f) => ({ ...f, re: rx(f.re.replace('RANGE', rules.range)) })),
    inGame: rx(rules.inGame),
    pathStart: rx(rules.pathStart),
    pathInText: new RegExp(`${rules.pathStart}[^\\s,;"']*`, 'gi'),
    fovTypes: rules.fovTypes.map((f) => ({ type: f.type, re: rx(f.match) })),
    fovLike: rx(rules.fovLikeLabel),
    sensLike: rx(rules.sensLikeLabel),
    exactHints: rules.exactHints.map(rx),
    fovAffects: rx(rules.fovAffects),
    engines: rules.engines,
    tokens: rules.pathTokens,
  };
}

/** Turn "[GAME FOLDER]\players2\config.cfg" into a Kirb path pattern. */
function toPattern(raw, R) {
  let p = raw.trim().replace(/[.,;:]+$/, '');
  for (const [tok, rep] of Object.entries(R.tokens)) {
    if (p.toLowerCase().startsWith(tok.toLowerCase())) { p = rep + p.slice(tok.length); break; }
  }
  p = p.replace(/\\/g, '/');
  const unresolved = /\[[A-Z ]+\]/i.test(p) ? p.match(/\[[A-Z ]+\]/i)[0] : null;
  return { raw: raw.trim().replace(/[.,;:]+$/, ''), pattern: p, unresolved };
}

/** Match a value line like `seta key "0.01 | 5 | 30"` or `Mouse Sensitivity 0.1 | 2.2 | 10`. */
function readValue(line, R) {
  for (const f of R.formats) {
    const m = f.re.exec(line);
    if (m) {
      return { name: m[1].trim(), min: Number(m[2]), def: Number(m[3]), max: Number(m[4]), format: f.id, inFile: f.inFile, decimals: decimalsOf(m[2], m[3], m[4]) };
    }
  }
  return null;
}

/** Split the paste into sections by the box's fixed labels. */
function sectionize(text, R) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/ /g, ' ').trim()).filter(Boolean);
  const title = lines.shift() || '';
  const out = [];
  let cur = { id: 'preamble', lines: [] };
  out.push(cur);
  for (const line of lines) {
    if (R.skip.some((r) => r.test(line))) continue;
    const bare = line.replace(/:\s*$/, '');
    let hit = R.sections.find((s) => s.re.test(bare));
    let rest = '';
    // "Engine: Source 2" on one line (not inside "Affected by", whose lines start with "FOV:")
    if (!hit && cur.id !== 'ignore' && cur.id !== 'affected') {
      const m = /^([^:]{2,30}):\s*(.+)$/.exec(line);
      if (m) { hit = R.sections.find((s) => s.re.test(m[1].trim())); rest = hit ? m[2] : ''; }
    }
    if (hit) {
      cur = { id: hit.id, label: bare, lines: rest ? [rest] : [] };
      out.push(cur);
    } else {
      cur.lines.push(line);
    }
  }
  return { title, sections: out };
}

/**
 * Parse a pasted Game Info box. Returns a draft:
 * { name, aim, kind: 'file'|'ingame', paths, inGame, sens, multipliers, fov, fovType, fovTypeText,
 *   engine, preset, exact, exactWhy, notes, fovNotes, mentionedPaths, unknown, checks, summary }
 */
function parse(text, rules = RULES) {
  const R = compile(rules);
  const { title, sections } = sectionize(text, R);
  const t = /^(.*?)\s+-\s+([^-]+)$/.exec(title);
  const d = {
    name: (t ? t[1] : title).trim(), aim: t ? t[2].trim() : null,
    kind: 'ingame', paths: [], inGame: null,
    sens: null, multipliers: [], fov: null, fovType: null, fovTypeText: null,
    engine: null, preset: null, exact: false, exactWhy: null,
    fovAffectsSens: null, fovAffectsHow: null, // true = FOV changes the sensitivity; null = unknown
    notes: [], fovNotes: [], mentionedPaths: [], unknown: [], checks: [],
  };

  for (const s of sections) {
    if (s.id === 'location') {
      let sub = null;
      for (const line of s.lines) {
        if (/:$/.test(line)) { sub = line.slice(0, -1); continue; }
        if (R.pathStart.test(line)) d.paths.push({ label: sub, ...toPattern(line, R) });
        else if (R.inGame.test(line)) d.inGame = line;
        else d.unknown.push({ section: 'Location', line });
      }
    } else if (s.id === 'sens' || s.id === 'multiplier' || s.id === 'fov') {
      for (const line of s.lines) {
        const v = readValue(line, R);
        if (!v) { d.unknown.push({ section: s.label, line }); continue; }
        v.slot = s.label;
        if (s.id === 'fov') d.fov = d.fov || v;
        else if (s.id === 'sens' && !d.sens) d.sens = v;
        else d.multipliers.push(v);
      }
    } else if (s.id === 'fovType') {
      d.fovTypeText = s.lines.join(' ').trim() || null;
      const hit = d.fovTypeText && R.fovTypes.find((f) => f.re.test(d.fovTypeText));
      d.fovType = hit ? hit.type : null;
    } else if (s.id === 'notes' || s.id === 'fovNotes') {
      d[s.id].push(...s.lines);
    } else if (s.id === 'engine') {
      d.engine = s.lines.join(' ').trim() || null;
    } else if (s.id === 'affected') {
      const m = R.fovAffects.exec(s.lines.join(' '));
      if (m) { d.fovAffectsSens = true; d.fovAffectsHow = m[1].trim(); }
    } else if (s.id === 'preamble' && s.lines.length) {
      s.lines.forEach((line) => d.unknown.push({ section: '(top)', line }));
    }
  }

  // The site sometimes uses "Sensitivity 1" for a FOV input (e.g. Deadlock). Then the real
  // sensitivity is a multiplier, and the number depends on FOV, so it can't be recalculated.
  if (d.sens && R.fovLike.test(d.sens.name)) {
    const real = d.multipliers.find((m) => R.sensLike.test(m.name));
    if (real) {
      d.multipliers = d.multipliers.filter((m) => m !== real);
      d.exact = true;
      d.exactWhy = `On mouse-sensitivity.com the result for this game depends on "${d.sens.name}", so use the exact number it gives you.`;
      d.sens = real;
    }
  }
  const allNotes = [...d.notes, ...d.fovNotes].join(' ');
  if (!d.exact && R.exactHints.some((r) => r.test(allNotes))) {
    d.exact = true;
    d.exactWhy = 'The notes say this game\'s sensitivity depends on other settings, so use the exact number mouse-sensitivity.com gives you.';
  }

  // Paths only mentioned in the notes (e.g. Halo's FOV file). Shown to the user, not used.
  const known = new Set(d.paths.map((p) => p.raw.toLowerCase()));
  for (const line of [...d.notes, ...d.fovNotes]) {
    for (const m of line.match(R.pathInText) || []) {
      const p = toPattern(m, R);
      if (!known.has(p.raw.toLowerCase())) { known.add(p.raw.toLowerCase()); d.mentionedPaths.push(p); }
    }
  }

  // A file game needs both a config path and a sensitivity written as a config line
  d.kind = d.paths.length && d.sens && d.sens.inFile ? 'file' : 'ingame';

  if (d.engine && !d.exact) d.preset = R.engines[d.engine.toLowerCase()] || null;

  // Things the user should look at
  if (!d.name) d.checks.push('No game name found. The first line of the box should be "<Game> - <Aim>".');
  if (!d.sens) d.checks.push('No sensitivity setting found.');
  if (d.fov && !d.fovType) d.checks.push(`FOV type "${d.fovTypeText || '?'}" isn't one Kirb knows, so FOV won't be matched automatically.`);
  if (d.paths.some((p) => p.unresolved)) d.checks.push(`Couldn't work out where ${d.paths.find((p) => p.unresolved).unresolved} is. Choose the file yourself.`);
  if (d.paths.length && d.sens && !d.sens.inFile) d.checks.push('The sensitivity is listed as an in-game setting, so this is set up as a type-in-game game.');
  if (d.unknown.length) d.checks.push(`${d.unknown.length} line${d.unknown.length > 1 ? 's' : ''} weren't understood and are shown below.`);

  d.summary = summaryNotes(d);
  return d;
}

/** The note shown on the game's row in the list. */
function summaryNotes(d) {
  const parts = [];
  if (d.kind === 'ingame') parts.push(d.inGame ? `Set in-game: ${d.inGame.replace(/\s*->\s*/g, ' > ')}.` : 'Set in-game.');
  if (d.sens && d.kind === 'ingame') parts.push(`Type the value into "${d.sens.name}".`);
  for (const m of d.multipliers) parts.push(`Keep "${m.name}" at the value you used on mouse-sensitivity.com (default ${m.def}).`);
  if (d.exact) parts.push('Uses the exact number from mouse-sensitivity.com.');
  if (d.fovAffectsSens) parts.push('FOV changes this game\'s sensitivity, so recalibrate if you change its FOV.');
  parts.push(...d.notes);
  parts.push('Imported from mouse-sensitivity.com.');
  return parts.join(' ');
}

// ---------------- matching a paste to a real config file ----------------
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(b));
const SIDE_SETTING = /(tpp|third|vehicle|zoom|ads|scope|aim|controller|gamepad|stick|joy|touch|gyro)/i;

/** How well a scanned config key fits a setting from the paste. Higher is better. */
function scoreKey(target, k, kind) {
  let s = 0;
  const why = [];
  if (norm(k.key) === norm(target.name)) { s += 100; why.push('same name'); }
  const meta = [['min', 'min'], ['def', 'default'], ['max', 'max']].filter(([f]) => near(k[f], target[f]));
  if (meta.length) { s += 10 * meta.length; why.push(`same ${meta.map((m) => m[1]).join('/')}`); }
  if (Number.isFinite(k.value)) s += k.value >= target.min && k.value <= target.max ? 2 : -20;
  if (k.kind === kind) s += 3;
  const label = target.name.toLowerCase();
  if (kind === 'sens') {
    if (/horizontal/.test(label)) s += /x$/i.test(k.key) ? 5 : /y$/i.test(k.key) ? -5 : 0;
    if (/vertical/.test(label)) s += /y$/i.test(k.key) ? 5 : /x$/i.test(k.key) ? -5 : 0;
    if (SIDE_SETTING.test(k.key) && !SIDE_SETTING.test(label)) s -= 8;
  }
  return { key: k, score: s, why };
}

function best(target, keys, kind, exclude) {
  if (!target) return null;
  const ranked = keys.filter((k) => k !== exclude).map((k) => scoreKey(target, k, kind)).sort((a, b) => b.score - a.score);
  // confident = same name, or at least two of min/default/max agree
  return ranked[0] && ranked[0].score >= 20 ? ranked[0] : null;
}

/**
 * Find the paste's sensitivity (and FOV) among a config file's scanned keys.
 * Returns { sens:{key,value,why}, sensAlso:[{key,value}], fov:{key,value,why}|null } or null.
 */
function matchKeys(draft, keys) {
  const s = best(draft.sens, keys, 'sens');
  if (!s) return null;
  const sens = { key: s.key.key, value: s.key.value, why: s.why.join(', ') || 'best fit', score: s.score };
  // keep vertical the same as horizontal when they're set the same now (e.g. FPP_MouseX + FPP_MouseY)
  const sensAlso = [];
  if (/x$/i.test(sens.key)) {
    const yKey = sens.key.replace(/x$/i, (c) => (c === 'x' ? 'y' : 'Y'));
    const y = keys.find((k) => k.key === yKey);
    if (y && y !== s.key && near(y.value, sens.value)) sensAlso.push({ key: y.key, value: y.value });
  }
  const f = best(draft.fov, keys, 'fov', s.key);
  const fov = f ? { key: f.key.key, value: f.key.value, why: f.why.join(', ') || 'best fit' } : null;
  return { sens, sensAlso, fov };
}

/**
 * What did the user just copy? { kind: 'gameinfo', text } for a Game Info box,
 * { kind: 'number', value, text } for a single sensitivity number, otherwise null.
 */
function classifyClipboard(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 20000) return null;
  const num = /^[-+]?(\d+(?:[.,]\d+)?|[.,]\d+)$/.exec(t);
  if (num) {
    const value = Number(t.replace(',', '.'));
    return Number.isFinite(value) && value > 0 ? { kind: 'number', value, text: t } : null;
  }
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hasTitle = lines.length > 3 && / - /.test(lines[0]);
  const hasWhere = lines.some((l) => /^(config files?|location):?$/i.test(l));
  const hasSens = lines.some((l) => /^sensitivity \d+:?$/i.test(l));
  return hasTitle && hasWhere && hasSens ? { kind: 'gameinfo', text: t } : null;
}

module.exports = { parse, RULES, toPattern, matchKeys, summaryNotes, classifyClipboard };
