'use strict';
// Checks every shared game in community/games/*.json against the audit trail in
// community/history.json, and writes the library the app downloads: community/games.json
// ({ games, history }). Exits with an error if anything is invalid, so CI catches bad changes.
//   node scripts/build-community.js          build
//   node scripts/build-community.js --check  only check that games.json is up to date
const fs = require('fs');
const path = require('path');
const C = require('../core/community');
const { PRESETS } = require('../core/engine');

const DIR = path.join(__dirname, '..', 'community', 'games');
const OUT = path.join(__dirname, '..', 'community', 'games.json');
const HISTORY = path.join(__dirname, '..', 'community', 'history.json');

const readHistory = () => (fs.existsSync(HISTORY) ? JSON.parse(fs.readFileSync(HISTORY, 'utf8')) : []);

function build() {
  fs.mkdirSync(DIR, { recursive: true });
  const games = [];
  const problems = [];
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.json')).sort()) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { problems.push(`${f}: not valid JSON (${e.message})`); continue; }
    const v = C.validateProfile(raw, PRESETS);
    if (!v.ok) { problems.push(`${f}: ${v.errors.join('; ')}`); continue; }
    if (`${v.profile.id}.json` !== f) { problems.push(`${f}: file name must be ${v.profile.id}.json`); continue; }
    games.push(v.profile);
  }
  let history = [];
  try { history = readHistory(); } catch (e) { problems.push(`history.json: not valid JSON (${e.message})`); }
  if (!Array.isArray(history)) { problems.push('history.json must be a list'); history = []; }
  problems.push(...C.checkHistory(games, history));
  return { games, history, problems, text: JSON.stringify({ games, history }, null, 2) + '\n' };
}

if (require.main === module) {
  const { games, problems, text } = build();
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur.replace(/\r/g, '') !== text) { console.error('community/games.json is out of date: run node scripts/build-community.js'); process.exit(1); }
    console.log(`community library OK (${games.length} games)`);
  } else {
    fs.writeFileSync(OUT, text);
    console.log(`wrote community/games.json (${games.length} games)`);
  }
}

module.exports = { build, readHistory, DIR, OUT, HISTORY };
