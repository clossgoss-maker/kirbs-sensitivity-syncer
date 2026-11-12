'use strict';
// Read-only helper for Unreal Engine .sav files (GVAS) that keep settings as string pairs, e.g. The Finals:
//   [int32 len]"GameplayOption.Controls.MouseSensitivity\0" [int32 len]"37.0\0"
// We never write these files: changing a string's length breaks the size fields around it.

function readFString(buf, at) {
  if (at + 4 > buf.length) return null;
  const len = buf.readInt32LE(at);
  if (len === 0) return { str: '', end: at + 4 };
  if (len > 0 && len < 4096 && at + 4 + len <= buf.length) {
    return { str: buf.toString('latin1', at + 4, at + 4 + len - 1), end: at + 4 + len };
  }
  if (len < 0 && -len < 2048 && at + 4 - len * 2 <= buf.length) {
    return { str: buf.toString('utf16le', at + 4, at + 4 + (-len - 1) * 2), end: at + 4 - len * 2 };
  }
  return null;
}

/** Find `key` stored as an FString and return the FString right after it (as text). */
function readValue(buf, key) {
  const needle = Buffer.from(key + '\0', 'latin1');
  let i = buf.indexOf(needle);
  while (i !== -1) {
    if (i >= 4 && buf.readInt32LE(i - 4) === needle.length) {
      const v = readFString(buf, i + needle.length);
      if (v) return v.str;
    }
    i = buf.indexOf(needle, i + 1);
  }
  return null;
}

function readNumber(buf, key) {
  const s = readValue(buf, key);
  if (s == null) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** All key -> numeric-string pairs (for the Add-a-game wizard). */
function scanPairs(buf) {
  const out = [];
  for (let at = 0; at + 8 < buf.length; at++) {
    const len = buf.readInt32LE(at);
    if (len < 4 || len > 200) continue;
    const end = at + 4 + len;
    if (end > buf.length || buf[end - 1] !== 0) continue;
    const key = buf.toString('latin1', at + 4, end - 1);
    if (!/^[A-Za-z_][\w.\-:]*$/.test(key)) continue;
    const v = readFString(buf, end);
    if (v && /^[-+]?\d*\.?\d+$/.test(v.str)) out.push({ key, value: parseFloat(v.str) });
    if (v) at = end - 1;
  }
  return out;
}

const isGvas = (buf) => buf.length > 4 && buf.toString('latin1', 0, 4) === 'GVAS';

module.exports = { readValue, readNumber, scanPairs, isGvas };
