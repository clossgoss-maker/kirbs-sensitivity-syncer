'use strict';
// Format-tolerant config editor.
// Handles the common shapes game configs use, line by line, without reformatting the file:
//   ini / Unreal:     Key=Value              (optionally inside [Section])
//   Source cfg:       key "value"   or  key value
//   Valve KV / vcfg:  "key"   "value"
//   JSON-ish:         "key": 1.25
//   XML element:      <key>1.25</key>
//   XML attribute:    key="1.25"
// Only the value is replaced; quotes, spacing, line endings and BOM are preserved.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';

/** Build regexes that find KEY with a numeric value. Each has groups: (prefix)(value)(suffix). */
function patternsFor(key) {
  const k = esc(key);
  return [
    { kind: 'ini', re: new RegExp(`^(\\s*${k}\\s*=\\s*"?)(${NUM})("?\\s*)$`, 'i') },
    { kind: 'kv', re: new RegExp(`^(\\s*"${k}"\\s+")(${NUM})(".*)$`, 'i') },
    // also Quake/CoD style: seta key "value"
    { kind: 'source', re: new RegExp(`^(\\s*(?:set[asu]?\\s+)?${k}\\s+"?)(${NUM})("?.*)$`, 'i') },
    { kind: 'json', re: new RegExp(`^(.*"${k}"\\s*:\\s*"?)(${NUM})("?.*)$`, 'i') },
    { kind: 'xmlel', re: new RegExp(`^(.*<${k}(?:\\s[^>]*)?>\\s*)(${NUM})(\\s*</${k}>.*)$`, 'i') },
    { kind: 'xmlattr', re: new RegExp(`^(.*\\b${k}\\s*=\\s*")(${NUM})(".*)$`, 'i') },
  ];
}

function splitText(text) {
  let bom = '';
  if (text.charCodeAt(0) === 0xfeff) { bom = '﻿'; text = text.slice(1); }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return { bom, eol, lines: text.split(/\r?\n/) };
}
const joinText = ({ bom, eol, lines }) => bom + lines.join(eol);

function formatNumber(n, decimals = 6) {
  if (decimals === 0) return String(Math.round(n));
  let s = n.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '.0');
  return s;
}

function sectionAt(lines, idx) {
  for (let i = idx; i >= 0; i--) {
    const m = /^\s*\[([^\]]+)\]\s*$/.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}

// Settings stored as named objects (e.g. Cyberpunk 2077's UserSettings.json):
//   { "name": "FPP_MouseX", "type": "float", "value": 4.0, "default_value": 5.0, "min_value": 1.0, "max_value": 30.0 }
const NAMED_RE = /^\s*"name"\s*:\s*"([^"]+)"/;
const NAMED_FIELD = new RegExp(`^(\\s*"(value|default_value|min_value|max_value)"\\s*:\\s*)(${NUM})(.*)$`);
function namedObjects(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = NAMED_RE.exec(lines[i]);
    if (!m) continue;
    const o = { key: m[1], nameLine: i, endLine: i, valueLine: null };
    for (let j = i + 1; j < lines.length && !NAMED_RE.test(lines[j]) && !/^\s*\}/.test(lines[j]); j++) {
      o.endLine = j;
      const f = NAMED_FIELD.exec(lines[j]);
      if (!f) continue;
      const n = parseFloat(f[3]);
      if (f[2] === 'value') { o.valueLine = j; o.value = n; o.raw = f[3]; }
      else o[{ default_value: 'def', min_value: 'min', max_value: 'max' }[f[2]]] = n;
    }
    if (o.valueLine != null) out.push(o);
  }
  return out;
}

/** Find every occurrence of a key. Returns [{line, kind, value, section}] */
function findKey(text, key, { section } = {}) {
  const hits = findKeyLines(text, key, { section });
  if (hits.length) return hits;
  return namedObjects(splitText(text).lines)
    .filter((o) => o.key.toLowerCase() === key.toLowerCase())
    .map((o) => ({ line: o.valueLine, kind: 'named', value: o.value, raw: o.raw, section: null }));
}

function findKeyLines(text, key, { section } = {}) {
  const { lines } = splitText(text);
  const pats = patternsFor(key);
  const hits = [];
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|;|#)/.test(line)) return; // skip comments
    for (const p of pats) {
      const m = p.re.exec(line);
      if (m) {
        const sec = sectionAt(lines, i);
        if (section && sec && sec.toLowerCase() !== section.toLowerCase()) break;
        hits.push({ line: i, kind: p.kind, value: parseFloat(m[2]), raw: m[2], section: sec });
        break;
      }
    }
  });
  return hits;
}

/**
 * Set a numeric key. Replaces all occurrences (optionally only within `section`).
 * If missing and `insert` is given, inserts it using that style:
 *   insert: 'source' | 'ini' | 'vcfg'
 * Returns { text, changed: [{line, from, to}], inserted: bool }
 */
function setKey(text, key, value, { section, decimals = 6, insert } = {}) {
  const parts = splitText(text);
  const { lines } = parts;
  const pats = patternsFor(key);
  const str = formatNumber(value, decimals);
  const changed = [];

  lines.forEach((line, i) => {
    if (/^\s*(\/\/|;|#)/.test(line)) return;
    for (const p of pats) {
      const m = p.re.exec(line);
      if (m) {
        const sec = sectionAt(lines, i);
        if (section && sec && sec.toLowerCase() !== section.toLowerCase()) break;
        lines[i] = m[1] + str + m[3];
        changed.push({ line: i + 1, from: m[2], to: str });
        break;
      }
    }
  });

  if (!changed.length) {
    for (const o of namedObjects(lines)) {
      if (o.key.toLowerCase() !== key.toLowerCase()) continue;
      const f = NAMED_FIELD.exec(lines[o.valueLine]);
      lines[o.valueLine] = f[1] + str + f[4];
      changed.push({ line: o.valueLine + 1, from: f[3], to: str });
    }
  }

  let inserted = false;
  if (!changed.length && insert) {
    inserted = true;
    if (insert === 'source') {
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      lines.push(`${key} "${str}"`, '');
    } else if (insert === 'ini') {
      const sec = section || 'Settings';
      let at = lines.findIndex((l) => l.trim().toLowerCase() === `[${sec.toLowerCase()}]`);
      if (at === -1) {
        while (lines.length && lines[lines.length - 1] === '') lines.pop();
        lines.push('', `[${sec}]`, `${key}=${str}`, '');
      } else {
        let end = at + 1;
        while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
        while (end - 1 > at && lines[end - 1].trim() === '') end--;
        lines.splice(end, 0, `${key}=${str}`);
      }
    } else if (insert === 'vcfg') {
      const at = lines.findIndex((l) => /^\s*"convars"\s*$/.test(l));
      const brace = at === -1 ? -1 : lines.findIndex((l, i) => i > at && l.trim() === '{');
      if (brace === -1) throw new Error(`Could not find a "convars" block to add ${key} to`);
      const indent = (lines[brace].match(/^\s*/)[0] || '') + '\t';
      lines.splice(brace + 1, 0, `${indent}"${key}"\t\t"${str}"`);
    } else {
      throw new Error(`Unknown insert style "${insert}"`);
    }
  }

  return { text: joinText(parts), changed, inserted };
}

/**
 * Scan a file for numeric settings and score how likely each is a sensitivity / FOV key.
 * Used by the "Add a game" wizard.
 */
function scanNumericKeys(text) {
  const { lines } = splitText(text);
  const out = [];
  const seen = new Set();
  const generic = [
    /^\s*\[?([A-Za-z_][\w.\-]*)\]?\s*=\s*"?(NUM)"?\s*$/,
    /^\s*"([^"]+)"\s+"(NUM)"/,
    /^\s*set[asu]?\s+([\w.\-]+)\s+"?(NUM)"?\s*$/,
    /^\s*([A-Za-z_][\w.\-]*)\s+"?(NUM)"?\s*$/,
    /"([^"]+)"\s*:\s*"?(NUM)"?/,
    /<([A-Za-z_][\w.\-]*)(?:\s[^>]*)?>\s*(NUM)\s*<\/\1>/,
  ].map((r) => new RegExp(r.source.replace(/NUM/g, NUM)));

  // named objects first; their "value"/"min_value" lines aren't settings of their own
  const consumed = new Set();
  for (const o of namedObjects(lines)) {
    for (let j = o.nameLine; j <= o.endLine; j++) consumed.add(j);
    if (seen.has(`|${o.key}`)) continue;
    seen.add(`|${o.key}`);
    out.push({ key: o.key, value: o.value, line: o.valueLine + 1, section: null, min: o.min, def: o.def, max: o.max, ...classify(o.key) });
  }

  lines.forEach((line, i) => {
    if (consumed.has(i) || /^\s*(\/\/|;|#)/.test(line)) return;
    for (const re of generic) {
      const m = re.exec(line);
      if (m) {
        const key = m[1];
        const section = sectionAt(lines, i);
        const id = `${section || ''}|${key}`;
        if (seen.has(id)) break;
        seen.add(id);
        out.push({ key, value: parseFloat(m[2]), line: i + 1, section, ...classify(key) });
        break;
      }
    }
  });
  return out.sort((a, b) => b.score - a.score);
}

function classify(key) {
  const k = key.toLowerCase();
  let kind = null, score = 0;
  if (/(field_?of_?view|\bfov|fov_|fovscale|fov$|^fov)/.test(k)) { kind = 'fov'; score = 3; }
  if (/sens/.test(k)) { kind = 'sens'; score = 3; }
  if (kind === 'sens' && /(mouse|look|yaw|^sensitivity$)/.test(k)) score = 4;
  if (!kind && /(^|_)mouse_?x$/.test(k)) { kind = 'sens'; score = 3; } // e.g. FPP_MouseX
  if (!kind && /(^|_)mouse_?y$/.test(k)) { kind = 'sens'; score = 2; }
  if (kind === 'sens' && /(zoom|ads|scope|aim|gamepad|controller|stick|joy|touch|gyro|vehicle|^tpp|third)/.test(k)) score = 1;
  if (!kind && /(yaw|mouse.?speed|look.?speed)/.test(k)) { kind = 'sens'; score = 2; }
  if (kind === 'fov' && /(viewmodel|weapon|vehicle|zoom|ads|scope)/.test(k)) score = 1;
  return { kind, score };
}

module.exports = { findKey, setKey, scanNumericKeys, formatNumber, classify };
