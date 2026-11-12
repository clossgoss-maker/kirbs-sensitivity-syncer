'use strict';
// Checks every shared game in community/games/*.json and writes the library the app downloads:
// community/games.json. Exits with an error if any game is invalid, so CI catches bad submissions.
//   node scripts/build-community.js          build
//   node scripts/build-community.js --check  only check that games.json is up to date
const fs = require('fs');
const path = require('path');
const C = require('../core/community');
const { PRESETS } = require('../core/engine');

const DIR = path.join(__dirname, '..', 'community', 'games');
const OUT = path.join(__dirname, '..', 'community', 'games.json');

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
  return { games, problems, text: JSON.stringify({ games }, null, 2) + '\n' };
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

module.exports = { build, DIR, OUT };
