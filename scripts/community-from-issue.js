'use strict';
// Used by .github/workflows/community.yml when a maintainer labels a "New game" issue "approved".
// Reads the profile JSON from the issue, validates it, and writes community/games/<id>.json plus the
// rebuilt library. The workflow then opens a pull request for a final look before merging.
// Usage: node scripts/community-from-issue.js <path to the GitHub event JSON>
const fs = require('fs');
const path = require('path');
const C = require('../core/community');
const { PRESETS } = require('../core/engine');
const { build, DIR, OUT } = require('./build-community');

function profileFromIssueBody(body) {
  // issue forms put the textarea under "### Game profile" in a ```json block
  const m = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(body || '');
  if (!m) throw new Error('No ```json block with the game profile was found in the issue.');
  return JSON.parse(m[1]);
}

function main() {
  const event = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const raw = profileFromIssueBody(event.issue && event.issue.body);
  const v = C.validateProfile(raw, PRESETS);
  if (!v.ok) throw new Error(`The profile isn't valid:\n- ${v.errors.join('\n- ')}`);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${v.profile.id}.json`), JSON.stringify(v.profile, null, 2) + '\n');
  const lib = build();
  if (lib.problems.length) throw new Error(lib.problems.join('\n'));
  fs.writeFileSync(OUT, lib.text);
  // hand the game's name and id to the workflow
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `id=${v.profile.id}\nname=${v.profile.name.replace(/[\r\n]/g, ' ')}\n`);
  console.log(`added ${v.profile.id}`);
}

if (require.main === module) {
  try { main(); } catch (e) {
    console.error(e.message);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `error<<EOF\n${e.message}\nEOF\n`);
    process.exit(1);
  }
}

module.exports = { profileFromIssueBody };
