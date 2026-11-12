'use strict';
/* global api */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 4) => (n == null ? '–' : String(Math.round(n * 10 ** d) / 10 ** d));
const FOV_TYPES = { h169: 'horizontal, 16:9', hnative: 'horizontal, my monitor', h43: 'horizontal, 4:3', v: 'vertical' };

let S = null; // app state from main process

// ---------------- your aim ----------------
function fillAim() {
  const p = S.prefs;
  $('#cm360').value = p.cm360;
  $('#dpi').value = p.dpi;
  const a = [...$('#aspect').options].reduce((best, o) => (Math.abs(o.value - p.aspect) < Math.abs(best.value - p.aspect) ? o : best));
  $('#aspect').value = a.value;
  $('#fovOn').checked = !!p.fov.enabled;
  $('#fovValue').value = p.fov.value;
  $('#fovType').value = p.fov.type;
  $('.fovfield').classList.toggle('off', !p.fov.enabled);
}

// Each game's notes start hidden; its "notes" button shows them
const openNotes = new Set();

// built-in: no tag; in the shared library: "shared"; added by you only: "custom"
function tagFor(g) {
  if (g.community || g.inLibrary) {
    const h = (S.history || []).filter((e) => e.id === g.id).pop();
    return `<span class="tag shared" title="In the shared game library${h ? ` since ${esc(h.date)}` : ''}">shared</span>`;
  }
  if (g.custom && !g.builtin) return '<span class="tag" title="Added by you">custom</span>';
  return '';
}

let saveTimer;
function onAimChange() {
  clearTimeout(saveTimer);
  $('.fovfield').classList.toggle('off', !$('#fovOn').checked);
  saveTimer = setTimeout(async () => {
    const cm = parseFloat($('#cm360').value), dpi = parseFloat($('#dpi').value), fv = parseFloat($('#fovValue').value);
    if (!(cm > 0) || !(dpi > 0)) return;
    S = await api.savePrefs({
      cm360: cm, dpi, aspect: parseFloat($('#aspect').value),
      fov: { enabled: $('#fovOn').checked, value: fv > 0 ? fv : S.prefs.fov.value, type: $('#fovType').value },
    });
    renderGames();
    const n = $('#savedNote'); n.classList.add('show'); setTimeout(() => n.classList.remove('show'), 900);
  }, 350);
}
['#cm360', '#dpi', '#aspect', '#fovOn', '#fovValue', '#fovType'].forEach((id) => $(id).addEventListener('input', onAimChange));

// ---------------- games list ----------------
const isReady = (g) => g.apply === 'file' && g.found && g.values.sens != null;
// pending = values an Apply would change; null when the app couldn't work it out (then allow Apply anyway)
const needsApply = (g) => isReady(g) && (!Array.isArray(g.pending) || g.pending.length > 0);
const currentMatches = (g) => !!(g.current && g.current.cm360 != null && Math.abs(g.current.cm360 - S.prefs.cm360) < 0.05);
function inSync(g) {
  if (g.apply === 'manual') return currentMatches(g);
  return isReady(g) && Array.isArray(g.pending) && g.pending.length === 0;
}

function chipFor(g) {
  if (inSync(g)) return '<span class="chip ok">In sync</span>';
  if (g.apply === 'manual') return '<span class="chip info">Type in-game</span>';
  if (g.values.sens == null) return '<span class="chip warn">Needs setup</span>';
  if (!g.found) return '<span class="chip bad">Not found</span>';
  return '<span class="chip warn">Out of sync</span>';
}

// "Currently set to" (read from the game's config) and "To match … set to" (what we'd write)
function syncCell(g) {
  const v = g.values, c = g.current;
  let now = null;
  if (!c) {
    if (g.apply === 'manual' && !g.fileIds.length) {
      now = `<span class="mute">Unknown (${g.builtin ? 'kept in your online account' : 'set in-game, so Kirb can\'t read it'})</span>`;
    }
  } else if (c.error) {
    if (g.found) now = `<span class="warn">${esc(c.error)}</span>`;
  } else {
    // FOV shown in the game's own units, so it lines up with the target below
    const fovNow = c.fovRaw != null ? ` · FOV ${esc(fmt(c.fovRaw, 4))}` : '';
    now = `<b>${esc(fmt(c.sens, 6))}</b>${c.cm360 != null ? ` = ${c.cm360} cm/360` : ' <span class="mute">(set up scaling to see cm/360)</span>'}${fovNow}`;
  }

  const fovOn = S.prefs.fov && S.prefs.fov.enabled;
  const fovTarget = g.hasFov && v.fov != null
    ? ` · FOV ${esc(fmt(v.fov, 4))}${v.fovDeg != null && v.fovDeg !== v.fov ? ` <span class="mute">(${fmt(v.fovDeg, 1)}°)</span>` : ''}`
    : g.fixedFov && fovOn ? ' <span class="mute">· FOV is fixed</span>' : '';
  const goal = `${S.prefs.cm360} cm/360${fovOn && g.hasFov ? ` and FOV ${S.prefs.fov.value}` : ''}`;
  const target = v.sens == null
    ? '<span class="warn">Needs setup. Click Set up to tell it how the sensitivity scales.</span>'
    : `<b class="big">${esc(fmt(v.sens, 6))}</b>${fovTarget}${inSync(g) ? ' <span class="okmark">✓ already set</span>' : ''}`;

  return `<div class="sync">
    ${now != null ? `<div class="k">Currently set to in config</div><div class="line">${now}</div>` : ''}
    <div class="k">To match ${esc(goal)}, set to</div><div class="line">${target}</div>
  </div>`;
}

function renderGames() {
  const box = $('#games');
  const ready = S.games.filter(isReady);
  const todo = ready.filter(needsApply);
  $('#summary').textContent = `${ready.length - todo.length} of ${ready.length} found game${ready.length === 1 ? '' : 's'} in sync · ${S.prefs.cm360} cm/360 @ ${S.prefs.dpi} DPI`;
  $('#applyAll').disabled = !todo.length;
  $('#applyAll').textContent = todo.length ? `Apply to ${todo.length} out-of-sync game${todo.length === 1 ? '' : 's'}` : 'All found games in sync';

  // installed & ready first, then manual, then the rest
  const rank = (g) => (g.apply === 'file' && g.found ? 0 : g.apply === 'manual' ? 1 : 2);
  const games = [...S.games].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  box.innerHTML = games.map((g) => {
    const v = g.values;
    const ready = isReady(g);
    const changes = Array.isArray(g.pending) ? g.pending.map((p) => `${p.key}: ${p.from ?? '(added)'} → ${p.to}`).join('\n') : '';
    const applyBtn = !ready ? '<button class="small primary" disabled>Apply</button>'
      : needsApply(g) ? `<button class="small primary" data-act="apply" data-id="${g.id}" title="${esc(changes || 'Write the new values')}">Apply</button>`
      : '<button class="small" disabled title="The config already has these values">Up to date</button>';
    const actions = g.apply === 'manual'
      ? `<button class="small" data-act="copy" data-id="${g.id}" ${v.sens == null ? 'disabled' : ''}>Copy value</button>`
      : `${applyBtn}
         <button class="small" data-act="preview" data-id="${g.id}" ${ready ? '' : 'disabled'}>Preview</button>`;
    return `<div class="game">
      <div><div class="name">${esc(g.name)}${tagFor(g)}${g.notes ? `<button class="notebtn" data-act="notes" data-id="${g.id}" title="${openNotes.has(g.id) ? 'Hide' : 'Show'} notes">${openNotes.has(g.id) ? 'notes ▴' : 'notes ▾'}</button>` : ''}</div>
           ${g.notes && openNotes.has(g.id) ? `<div class="note">${esc(g.notes)}</div>` : ''}</div>
      <div>${chipFor(g)}</div>
      ${syncCell(g)}
      <div class="actions">${actions}
        ${g.current && g.current.cm360 != null && Math.abs(g.current.cm360 - S.prefs.cm360) >= 0.05 ? `<button class="small ghost" data-act="adopt" data-id="${g.id}" title="Make this game's current setting your target cm/360">Use as target</button>` : ''}
        <button class="small ghost" data-act="setup" data-id="${g.id}">Set up</button></div>
      ${v.warnings.length ? `<div class="warns">${v.warnings.map(esc).join('<br>')}</div>` : ''}
    </div>`;
  }).join('');
}

$('#games').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const g = S.games.find((x) => x.id === b.dataset.id);
  const act = b.dataset.act;
  try {
    if (act === 'apply') await doApply([g.id]);
    if (act === 'preview') showResult(g.name, await api.preview(g.id), true);
    if (act === 'copy') { await navigator.clipboard.writeText(String(g.values.sens)); b.textContent = 'Copied ✓'; setTimeout(() => (b.textContent = 'Copy value'), 1200); }
    if (act === 'setup') openSetup(g.id);
    if (act === 'notes') { if (openNotes.has(g.id)) openNotes.delete(g.id); else openNotes.add(g.id); renderGames(); }
    if (act === 'adopt') {
      if (!confirm(`Set your target to ${g.name}'s current ${g.current.cm360} cm/360${g.current.fov != null ? ` and FOV ${g.current.fov}` : ''}?`)) return;
      S = await api.adopt(g.id); fillAim(); renderGames();
      log(`<span class="ok">Target set from ${esc(g.name)}: ${S.prefs.cm360} cm/360 @ ${S.prefs.dpi} DPI</span>`);
    }
  } catch (err) { log(`<span class="bad">✗ ${esc(err.message)}</span>`); }
});

$('#applyAll').addEventListener('click', () => doApply(S.games.filter(needsApply).map((g) => g.id)));
$('#refresh').addEventListener('click', refresh);
$('#addGame').addEventListener('click', openWizard);
$('#msLink').addEventListener('click', (e) => { e.preventDefault(); api.openExternal('https://www.mouse-sensitivity.com/'); });

async function doApply(ids) {
  clearLog();
  for (const id of ids) {
    const g = S.games.find((x) => x.id === id);
    let r = await api.apply(id, false);
    if (!r.applied && r.errors.some((m) => /is running/.test(m))) {
      if (confirm(`${g.name} looks like it's running. If you write the file now, the game will probably overwrite it when it closes.\n\nWrite anyway?`)) r = await api.apply(id, true);
    }
    showResult(g.name, r, false);
  }
  await refresh();
}

function clearLog() { $('#log').innerHTML = ''; }
function log(html) { const l = $('#log'); l.classList.remove('hidden'); l.insertAdjacentHTML('beforeend', `<div class="result-line">${html}</div>`); l.scrollTop = l.scrollHeight; }

function showResult(name, r, isPreview) {
  if (isPreview) clearLog();
  log(`<b>${esc(name)}</b>${isPreview ? ' <span class="mute">(preview, nothing written)</span>' : r.applied ? ' <span class="ok">✓ applied</span>' : ''}`);
  (r.errors || []).forEach((m) => log(`  <span class="bad">✗ ${esc(m)}</span>`));
  (r.values?.warnings || []).forEach((m) => log(`  <span class="warn">! ${esc(m)}</span>`));
  (r.edits || []).forEach((e) => {
    log(`  <span class="mute">${esc(e.file)}</span>`);
    e.changes.forEach((c) => log(`     ${esc(c.key)}: ${esc(c.from ?? '(added)')} → <span class="ok">${esc(c.to)}</span>`));
    if (e.error) log(`     <span class="bad">✗ ${esc(e.error)}</span>`);
  });
  if (r.backup) log(`  <span class="mute">backup saved: ${esc(r.backup)}</span>`);
}

// ---------------- modal helpers ----------------
const quiet = (p) => { try { Promise.resolve(p).catch(() => {}); } catch { /* not available here */ } };
// the clipboard is only watched while a dialog is open
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); quiet(api.watchClipboard(true)); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; quiet(api.watchClipboard(false)); }

// ---------------- mouse-sensitivity.com helper: open it, copy numbers, pick up what the user copies ----------------
const MS_URL = 'https://www.mouse-sensitivity.com/';
let selfCopied = null; // text our own copy buttons put on the clipboard, so we don't pick it up again

/** Copy buttons for the numbers the site's calculator needs, plus a button to open it. */
function calcHelp(gameName, fov = null) {
  const chip = (label, value, id = '') => `<button class="small chipbtn" ${id ? `id="${id}"` : ''} data-copy="${esc(value)}" title="Copy">${esc(label)} <span>⧉</span></button>`;
  return `<div class="calchelp">
    <button class="small primary" data-open-calc>Open calculator</button>
    ${gameName ? chip(gameName, gameName) : ''}${chip(`${S.prefs.cm360} cm/360`, S.prefs.cm360)}${chip(`${S.prefs.dpi} DPI`, S.prefs.dpi)}${fov != null ? chip(`FOV ${fov}`, fov, 'fovChip') : ''}
    <span class="mute">Copy the result there and it fills in here by itself.</span>
  </div>`;
}

// The site opens in a panel on the right; the page makes room for it and draws the panel's top bar
function onSidePanel(s) {
  const root = document.documentElement;
  root.classList.toggle('side-open', !!s.open);
  root.style.setProperty('--side', `${s.open ? s.width : 0}px`);
  root.style.setProperty('--sidebar', `${s.bar || 44}px`);
  $('#sidebar').classList.toggle('hidden', !s.open);
}
quiet(api.onSidePanel && api.onSidePanel(onSidePanel));
$('#sidebar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-nav]');
  if (b) quiet(api.sideNav(b.dataset.nav));
});
$('#sideClose').addEventListener('click', () => quiet(api.closeCalculator()));

async function openCalculator() {
  let opened = false;
  try { opened = await api.openCalculator(); } catch { /* fall back */ }
  if (!opened) api.openExternal(MS_URL);
}

$('#modalBody').addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    selfCopied = copy.dataset.copy;
    try { await navigator.clipboard.writeText(selfCopied); } catch { /* ignore */ }
    copy.classList.add('copied'); setTimeout(() => copy.classList.remove('copied'), 900);
  }
  if (e.target.closest('[data-open-calc]')) openCalculator();
});

function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

/** Something the user copied: a Game Info box goes into the import, a number into the value box. */
function handleClipboard(hit) {
  if (!hit || $('#modal').classList.contains('hidden') || hit.text === String(selfCopied)) return;
  if (hit.kind === 'gameinfo') {
    const ta = $('#wPaste');
    if (!ta || ta.value.trim() === hit.text) return;
    ta.value = hit.text;
    $('#wRead').click();
    return toast('Picked up the Game Info box you copied');
  }
  let input = $('#cVal');
  if (!input) {
    input = $('#pasteVal');
    if (input && input.closest('[data-pane]').classList.contains('hidden')) {
      input.closest('[data-pane]').parentElement.querySelector('[data-tab="paste"]')?.click();
    }
  }
  if (!input) return;
  input.value = hit.value;
  input.dispatchEvent(new Event('input'));
  input.classList.add('flash'); setTimeout(() => input.classList.remove('flash'), 1200);
  toast(`Picked up ${hit.value} from the clipboard`);
}
quiet(api.onClipboard && api.onClipboard(handleClipboard));
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// Shared "how does this game's sensitivity scale" block
function scalingBlock(g) {
  const gp = (g && g.gamePrefs) || {};
  const cur = gp.manualSens != null ? `a fixed value you pasted (${gp.manualSens})`
    : gp.calibration ? `your calibration (${gp.calibration.sens} = ${gp.calibration.cm360} cm/360 @ ${gp.calibration.dpi} DPI)`
    : g && g.yaw ? `the built-in formula (yaw ${g.yaw})` : 'not set up yet';
  return `
    <h3>Sensitivity scaling</h3>
    <p>Right now this uses ${esc(cur)}.</p>
    <div class="tabs">
      <button data-tab="paste" class="on">Paste a value</button>
      <button data-tab="preset">Known engine</button>
      <button data-tab="measure">I know a value's cm/360</button>
      <button data-tab="yaw">Enter yaw</button>
    </div>
    <div data-pane="paste">
      <p>On mouse-sensitivity.com, convert to <b>${S.prefs.cm360} cm/360 at ${S.prefs.dpi} DPI</b> for this game and paste the number it gives you. The app learns the game's scaling from it, so later changes to your cm/360 still work.</p>
      ${calcHelp(g ? g.name : null)}
      <div class="row"><input id="pasteVal" type="number" step="any" placeholder="e.g. 0.4719" />
        <label class="toggle"><input type="checkbox" id="pasteFixed" /> <span>Use this exact number, never recalculate</span></label></div>
    </div>
    <div data-pane="preset" class="hidden">
      <p>If the game runs on one of these engines and keeps the engine's default scaling, pick it and you're done. Not sure? Use <b>Paste a value</b> instead.</p>
      <div class="row"><select id="presetSel">
        <option value="">Choose an engine…</option>
        ${(S.presets || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (yaw ${esc(p.yaw)})</option>`).join('')}
      </select></div>
      <p id="presetInfo" class="mono" style="font-size:12px"></p>
    </div>
    <div data-pane="measure" class="hidden">
      <p>If you already know that some sensitivity value gives a certain cm/360 (from a guide, an old setup, or measuring a 360 on your mousepad), enter it here.</p>
      <div class="row">Sensitivity <input id="mSens" type="number" step="any" style="width:110px" /> gives
        <input id="mCm" type="number" step="any" style="width:100px" /> cm/360 at
        <input id="mDpi" type="number" step="50" style="width:90px" value="${S.prefs.dpi}" /> DPI</div>
    </div>
    <div data-pane="yaw" class="hidden">
      <p>Degrees turned per mouse count at sensitivity 1. Source/Apex = 0.022, Valorant = 0.07, Overwatch = 0.0066. mouse-sensitivity.com lists it as "Yaw" for many games.</p>
      <div class="row"><input id="yawVal" type="number" step="any" placeholder="0.022" style="width:140px" /></div>
    </div>`;
}

function wireTabs(root) {
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
    root.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
  }));
  const sel = $('#presetSel', root);
  sel?.addEventListener('change', () => {
    const p = presetById(sel.value);
    $('#presetInfo', root).textContent = p ? `Used by: ${p.examples}${p.fovType ? ` · FOV: ${FOV_TYPES[p.fovType]}` : ''}` : '';
    // in the Add a game wizard, also suggest the engine's FOV type
    const ft = $('#wFovType');
    if (p && p.fovType && ft && root.contains(ft)) ft.value = p.fovType;
  });
}

const presetById = (id) => (S.presets || []).find((p) => p.id === id) || null;

// A yaw stored as a calibration, so it can override a built-in game's yaw too
const yawPatch = (y) => ({ calibration: { sens: 1, cm360: (360 / (y * S.prefs.dpi)) * 2.54, dpi: S.prefs.dpi }, manualSens: null });

/** Read the scaling block. Returns {patch} for game prefs (plus {yaw} when the scaling is a plain yaw), or null if empty. */
function readScaling(root) {
  const tab = root.querySelector('[data-tab].on').dataset.tab;
  if (tab === 'preset') {
    const p = presetById($('#presetSel', root).value);
    return p ? { patch: yawPatch(p.yaw), yaw: p.yaw } : null;
  }
  if (tab === 'paste') {
    const v = parseFloat($('#pasteVal', root).value);
    if (!(v > 0)) return null;
    return $('#pasteFixed', root).checked
      ? { patch: { manualSens: v, calibration: null } }
      : { patch: { calibration: { sens: v, cm360: S.prefs.cm360, dpi: S.prefs.dpi }, manualSens: null } };
  }
  if (tab === 'measure') {
    const s = parseFloat($('#mSens', root).value), c = parseFloat($('#mCm', root).value), d = parseFloat($('#mDpi', root).value);
    if (!(s > 0 && c > 0 && d > 0)) return null;
    return { patch: { calibration: { sens: s, cm360: c, dpi: d }, manualSens: null } };
  }
  const y = parseFloat($('#yawVal', root).value);
  if (!(y > 0)) return null;
  return { patch: yawPatch(y), yaw: y };
}

// ---------------- per-game setup ----------------
function openSetup(id) {
  const g = S.games.find((x) => x.id === id);
  const gp = g.gamePrefs || {};
  const fileBlocks = g.apply === 'manual' ? '<p>This game keeps its settings online, so there\'s no file to edit. Type the value shown into the game.</p>'
    : g.fileIds.map((fid) => {
      const files = g.files[fid] || [];
      const manual = gp.filePaths && gp.filePaths[fid];
      return `<div style="margin:8px 0 14px">
        <div class="row" style="justify-content:space-between"><b>${esc(fid)}</b>
          <span class="row">${manual ? `<button class="small ghost" data-auto="${esc(fid)}">Use auto-detect</button>` : ''}
          <button class="small" data-choose="${esc(fid)}">Choose file…</button></span></div>
        <div class="paths">${files.length ? files.map((f) => `<div>${esc(f)} <button class="link small" data-show="${esc(f)}">show</button></div>`).join('') : '<span class="none">Not found. Launch the game once (change any setting, then quit), or choose the file.</span>'}</div>
        ${manual ? '<p>Using a file you chose.</p>' : ''}</div>`;
    }).join('');

  openModal(`
    <h2>${esc(g.name)}</h2><p>${esc(g.notes)}</p>
    <h3>Config file${g.fileIds.length > 1 ? 's' : ''}</h3>${fileBlocks}
    ${g.community || g.inLibrary ? `<h3>Shared library history</h3>${historyTable((S.history || []).filter((e) => e.id === g.id))}` : ''}
    ${scalingBlock(g)}
    <div class="foot">
      ${g.backups ? `<button id="restoreBtn">Restore last backup (${g.backups})</button>` : ''}
      ${gp.calibration || gp.manualSens != null ? '<button id="resetScale" class="ghost">Reset scaling</button>' : ''}
      ${g.custom && !g.builtin ? '<button id="delGame" class="ghost" style="color:var(--bad)">Remove game</button>' : ''}
      ${g.custom && !g.builtin ? '<button id="shareGame">Share with everyone…</button>' : ''}
      ${g.community ? '<button id="reportGame" class="ghost">Report a wrong value</button>' : ''}
      <button id="saveSetup" class="primary">Save</button>
    </div>`);
  const root = $('#modalBody');
  wireTabs(root);
  root.querySelectorAll('[data-choose]').forEach((b) => b.addEventListener('click', async () => {
    const f = await api.chooseFile(`Choose ${g.name}'s ${b.dataset.choose} config file`);
    if (!f) return;
    S = await api.setGamePrefs(id, { filePaths: { ...(gp.filePaths || {}), [b.dataset.choose]: f } });
    renderGames(); openSetup(id);
  }));
  root.querySelectorAll('[data-auto]').forEach((b) => b.addEventListener('click', async () => {
    const fp = { ...(gp.filePaths || {}) }; delete fp[b.dataset.auto];
    S = await api.setGamePrefs(id, { filePaths: fp });
    renderGames(); openSetup(id);
  }));
  root.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => api.showFile(b.dataset.show)));
  $('#saveSetup').addEventListener('click', async () => {
    const sc = readScaling(root);
    // remember the FOV this calibration was made at
    if (sc && sc.patch.calibration && g.fovForCal != null) sc.patch.calibration.fov = g.fovForCal;
    if (sc) S = await api.setGamePrefs(id, sc.patch);
    closeModal(); renderGames();
  });
  $('#resetScale')?.addEventListener('click', async () => { S = await api.setGamePrefs(id, { calibration: null, manualSens: null }); closeModal(); renderGames(); });
  $('#restoreBtn')?.addEventListener('click', async () => {
    if (!confirm(`Put ${g.name}'s config back to how it was before the last Apply?`)) return;
    try { const r = await api.restore(id); clearLog(); log(`<b>${esc(g.name)}</b> <span class="ok">restored</span>`); r.restored.forEach((f) => log(`  <span class="mute">${esc(f)}</span>`)); }
    catch (err) { log(`<span class="bad">✗ ${esc(err.message)}</span>`); }
    closeModal(); refresh();
  });
  $('#shareGame')?.addEventListener('click', () => openShare(id));
  $('#reportGame')?.addEventListener('click', async () => {
    const url = await api.reportUrl(id);
    if (url) api.openExternal(url);
  });
  $('#delGame')?.addEventListener('click', async () => { if (confirm(`Remove ${g.name} from the list? Its config file isn't touched.`)) { S = await api.deleteCustomGame(id); closeModal(); renderGames(); } });
}

// ---------------- share a game with everyone ----------------
async function openShare(id, note = '') {
  const g = S.games.find((x) => x.id === id);
  let r;
  try { r = await api.shareGame(id, note || undefined); } catch (err) { return alert(err.message); }
  openModal(`
    <h2>Share ${esc(g.name)} with everyone</h2>
    <p>This sends the game to the shared library: where its config file is, which settings to change, ranges, FOV type, and its <b>yaw</b> from your calibration, so friends get it ready to go with no setup.
      Your own cm/360 and DPI aren't included, and anyone's own calibration always wins over a shared yaw.</p>
    ${r.ok ? '' : `<ul class="importlist">${r.errors.map((e) => `<li class="warn">${esc(e)}</li>`).join('')}</ul>`}
    ${(r.warnings || []).length ? `<ul class="importlist">${r.warnings.map((e) => `<li class="warn">${esc(e)}</li>`).join('')}</ul>` : ''}
    <h3>Note for other players (optional)</h3>
    <textarea id="shareNote" rows="2" maxlength="300" placeholder="e.g. Close the game before applying. Works with the Steam version.">${esc(note)}</textarea>
    <div class="row" style="margin-top:6px"><button id="shareUpdate" class="small">Update preview</button></div>
    ${r.profile ? `<h3>What gets shared</h3><pre class="unknown" style="color:var(--text)">${esc(JSON.stringify(r.profile, null, 2))}</pre>` : ''}
    <p><b>Have a GitHub account?</b> Open on GitHub sends it straight to the shared library for approval.<br>
      <b>No GitHub account?</b> Copy the share code and send it to whoever runs the library (Discord, text, anything). They add it for you.</p>
    <div class="foot">
      <button id="shareBack" class="ghost">Back</button>
      <button id="shareCopy" ${r.ok ? '' : 'disabled'}>Copy share code</button>
      <button id="shareGo" class="primary" ${r.ok && r.url ? '' : 'disabled'}>Open on GitHub</button>
    </div>`);
  $('#shareCopy').addEventListener('click', async () => {
    const code = JSON.stringify(r.profile, null, 2);
    selfCopied = code; // don't let the clipboard pickup react to our own copy
    try { await navigator.clipboard.writeText(code); toast('Share code copied. Paste it to whoever runs the library.'); } catch { /* ignore */ }
  });
  $('#shareUpdate').addEventListener('click', () => openShare(id, $('#shareNote').value.trim()));
  $('#shareBack').addEventListener('click', () => openSetup(id));
  $('#shareGo').addEventListener('click', () => { if (r.url) api.openExternal(r.url); });
}

// ---------------- shared library history (audit trail) ----------------
function historyTable(entries) {
  if (!entries.length) return '<p>Nothing yet.</p>';
  const repo = S.repo;
  return `<table class="keytable history">
    <tr><th>Date</th><th>Game</th><th>Change</th><th>Yaw</th><th>FOV</th><th>By</th><th></th></tr>
    ${entries.slice().reverse().map((e) => `<tr>
      <td class="mono">${esc(e.date)}</td><td>${esc(e.name)}</td><td>${esc(e.action)}</td>
      <td class="mono">${e.yaw != null ? esc(fmt(e.yaw, 8)) : '<span class="mute">none</span>'}</td>
      <td class="mono">${e.calFov != null ? esc(e.calFov) : ''}</td>
      <td>${e.by ? esc(e.by) : ''}</td>
      <td>${e.issue && repo ? `<button class="link small" data-url="https://github.com/${esc(repo)}/issues/${e.issue}">#${e.issue}</button>` : ''}</td>
    </tr>${e.note ? `<tr class="hnote"><td></td><td colspan="6">${esc(e.note)}</td></tr>` : ''}`).join('')}
  </table>`;
}

function openHistory() {
  openModal(`
    <h2>Shared library history</h2>
    <p>Every game added to the shared library or changed, with the yaw it had at the time. Newest first.</p>
    ${historyTable(S.history || [])}
    ${S.repo ? `<p class="mute" style="margin-top:12px">The full record, with every change, is the <button class="link small" data-url="https://github.com/${esc(S.repo)}/commits/main/community">library's history on GitHub</button>.</p>` : ''}`);
}
$('#historyBtn').addEventListener('click', openHistory);
$('#modalBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-url]');
  if (b) api.openExternal(b.dataset.url);
});

// ---------------- updates and the shared library ----------------
function onUpdate(s) {
  let bar = $('#updateBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'updateBar';
    document.body.insertBefore(bar, document.body.firstChild);
  }
  bar.innerHTML = s.state === 'ready'
    ? `Kirb fetched version ${esc(s.version)}. <button class="small primary" id="updNow">Restart to update</button>`
    : `Kirb is fetching version ${esc(s.version)}…`;
  $('#updNow')?.addEventListener('click', () => quiet(api.installUpdate()));
}
quiet(api.onUpdate && api.onUpdate(onUpdate));
quiet(api.onCommunityUpdated && api.onCommunityUpdated(() => refresh()));

// ---------------- add-a-game wizard ----------------
const W = {};
function openWizard() {
  Object.assign(W, { name: '', file: null, keys: [], sensKey: null, fovKey: null, results: null, imp: null });
  openModal(`
    <h2>Add a game</h2>
    <p>Type the game's name and Kirb will search Steam, Saved Games, Documents\\My Games and AppData for config files with sensitivity or FOV settings.</p>
    <div class="row" style="margin-top:12px">
      <input type="text" id="wName" placeholder="Game name, e.g. The Finals" />
      <button id="wSearch" class="primary">Search</button>
      <button id="wBrowse">Choose file…</button>
    </div>
    <div id="wResults" style="margin-top:14px"></div>
    <h3>Or get the game's info from mouse-sensitivity.com</h3>
    <p>Open the calculator, pick the game, then select the whole Game Info box at the bottom and copy it (Ctrl+C). Kirb picks it up by itself and finds the game's settings. You can also paste it below.</p>
    <div class="row" style="margin:8px 0"><button class="primary" data-open-calc>Open mouse-sensitivity.com</button></div>
    <textarea id="wPaste" rows="4" spellcheck="false" placeholder="Call of Duty 4: Modern Warfare - Hipfire&#10;Config File&#10;…"></textarea>
    <div class="row" style="margin-top:8px"><button id="wRead">Read pasted info</button></div>
    <div id="wImport"></div>
    <div id="wStep2"></div>`);
  $('#wRead').addEventListener('click', async () => {
    const text = $('#wPaste').value;
    if (!text.trim()) return $('#wPaste').focus();
    try { renderImport(await api.importText(text)); }
    catch (err) { $('#wImport').innerHTML = `<p class="warn">Couldn't read that: ${esc(err.message)}</p>`; }
  });
  const name = $('#wName'); name.focus();
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#wSearch').click(); });
  $('#wSearch').addEventListener('click', async () => {
    W.name = name.value.trim();
    if (!W.name) return name.focus();
    $('#wResults').innerHTML = '<p>Searching…</p>';
    const r = await api.discover(W.name);
    W.results = r.files;
    $('#wResults').innerHTML = r.files.length
      ? `<p>Found ${r.files.length} file${r.files.length > 1 ? 's' : ''}. Pick the one with your mouse settings:</p><div class="list">${r.files.map((f, i) => `
          <button class="pick" data-i="${i}"><div class="path">${esc(f.file)}${f.readOnly ? ' <span class="tag">read-only</span>' : ''}</div>
          <div class="keys">${f.keys.slice(0, 4).map((k) => `${esc(k.key)}=${esc(k.value)}`).join('   ')}</div></button>`).join('')}</div>`
      : `<p>Nothing found in ${r.searched.length} matching folder${r.searched.length === 1 ? '' : 's'}. Some games use a different folder name than the game (The Finals uses "Discovery", for example). Try another name, or use <b>Choose file…</b>. If you've never launched the game, start it once, change any setting, and quit, so it writes its config.</p>`;
    $('#wResults').querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => {
      $('#wResults').querySelectorAll('.pick').forEach((x) => x.classList.remove('on')); b.classList.add('on');
      const f = W.results[+b.dataset.i]; pickFile(f.file);
    }));
  });
  $('#wBrowse').addEventListener('click', async () => {
    const f = await api.chooseFile(); if (f) { W.name = W.name || name.value.trim(); pickFile(f); }
  });
}

// ---- paste from mouse-sensitivity.com ----
function renderImport(res) {
  const d = res.draft;
  W.imp = null; $('#wStep2').innerHTML = '';
  const item = (cls, html) => `<li class="${cls}">${html}</li>`;
  const range = (v) => `${esc(v.min)} to ${esc(v.max)}, default ${esc(v.def)}`;
  const firstFound = res.files.flatMap((f) => f.found)[0];
  const items = [];

  if (d.kind === 'file') {
    for (const f of res.files) {
      items.push(item(f.found.length ? 'ok' : 'warn', `${esc(f.label || 'Config file')}: <span class="mono">${esc(f.raw)}</span> ${
        f.found.length ? `<b>found</b>${f.found.length > 1 ? ` (${f.found.length} copies)` : ''}` : f.unresolved ? '(Kirb can\'t locate this folder)' : '(not found on this PC)'}`));
    }
  } else {
    items.push(item('info', `Set in-game${d.inGame ? `: ${esc(d.inGame)}` : ''}. Kirb will show the value to type in.`));
  }
  if (d.sens) {
    const now = d.kind === 'file' && firstFound ? (firstFound.sens != null ? `, currently ${esc(firstFound.sens)}` : ', <span class="warn">not in the file yet</span>') : '';
    items.push(item('ok', `Sensitivity setting: <span class="mono">${esc(d.sens.name)}</span> (${range(d.sens)})${now}`));
  }
  for (const m of d.multipliers) items.push(item('info', `Also uses <span class="mono">${esc(m.name)}</span> (default ${esc(m.def)}). Keep it at the value you used on the site.`));
  if (d.fov) {
    items.push(item(d.fovType ? 'ok' : 'warn', `FOV setting: <span class="mono">${esc(d.fov.name)}</span> (${range(d.fov)}), ${
      d.fovType ? esc(FOV_TYPES[d.fovType]) : `type "${esc(d.fovTypeText || '?')}" isn't one Kirb knows, so FOV won't be matched`}`));
  }
  if (d.engine) {
    const p = presetById(d.preset);
    items.push(item(p ? 'ok' : 'info', `Engine: ${esc(d.engine)}${p ? ` (uses the ${esc(p.name)} preset, yaw ${esc(p.yaw)})` : ' (no preset, so you\'ll set the scaling once)'}`));
  }
  if (d.exact) items.push(item('warn', esc(d.exactWhy)));
  for (const c of d.checks.filter((c) => !/weren't understood|isn't one Kirb knows/.test(c))) items.push(item('warn', esc(c)));
  for (const p of d.mentionedPaths) items.push(item('info', `The notes also mention <span class="mono">${esc(p.raw)}</span>`));

  const unknown = d.unknown.length
    ? `<p>These lines weren't understood, so check them against the form below:</p><pre class="unknown">${d.unknown.map((u) => esc(`${u.section}: ${u.line}`)).join('\n')}</pre>` : '';

  let next = '';
  if (!d.sens) next = '<p class="warn">No sensitivity setting was found, so this can\'t be imported. Check you copied the whole Game Info box.</p>';
  else if (res.match) next = '';
  else if (d.kind === 'file') {
    next = firstFound
      ? '<button id="wUseImport" class="primary">Use this</button> <button id="wImportChoose">Choose a different file…</button>'
      : '<p>The config file wasn\'t found. Launch the game once (change any setting, then quit) so it creates it, or choose it yourself.</p><button id="wImportChoose" class="primary">Choose file…</button>';
  } else next = '<button id="wUseImport" class="primary">Continue</button>';

  $('#wImport').innerHTML = `
    <div class="importbox">
      <b>${esc(d.name || 'Unnamed game')}</b>${d.aim ? ` <span class="tag">${esc(d.aim)}</span>` : ''}
      <ul class="importlist">${items.join('')}</ul>${unknown}
      ${next ? `<div class="row">${next}</div>` : ''}
    </div>
    ${res.match ? calibratePanel(d, res.match) : ''}`;
  if (res.match) wireCalibrate(d, res.match);
  const allFound = res.files.flatMap((f) => f.found.map((x) => x.file));
  $('#wUseImport')?.addEventListener('click', () => (d.kind === 'file' ? pickFile(allFound[0], { draft: d, files: allFound }) : manualStep(d)));
  $('#wImportChoose')?.addEventListener('click', async () => {
    const f = await api.chooseFile(`Choose ${d.name}'s config file`);
    if (f) pickFile(f, { draft: d, files: [f] });
  });
}

// ---- found the game's current setting: calibrate to target in one step ----
// FOV can change a game's sensitivity, so it's settled first and the calibration remembers it
const canSetFov = (d, match) => !!(match.fov && d.fovType && match.fovTarget && match.fovTarget.value != null);
function chosenFov(d, match) {
  if (!match.fov) return null;
  if (!canSetFov(d, match)) return match.fov.value;
  return $('input[name=cFovMode]:checked')?.value === 'set' ? match.fovTarget.value : match.fov.value;
}

// before the radios exist: same default as fovStep picks
function defaultFov(d, match) {
  if (!match.fov) return null;
  if (!canSetFov(d, match)) return match.fov.value;
  return S.prefs.fov.enabled || d.fovAffectsSens === true ? match.fovTarget.value : match.fov.value;
}

function fovStep(d, match) {
  if (!match.fov) return '';
  const why = d.fovAffectsSens
    ? `<p class="warn">FOV changes this game's sensitivity${d.fovAffectsHow ? ` (${esc(d.fovAffectsHow)})` : ''}, so set it now and enter the same FOV in the calculator.</p>`
    : '<p>Some games\' sensitivity depends on FOV, so set it before calibrating. If the calculator has a FOV box for this game, enter the same FOV there.</p>';
  if (!canSetFov(d, match)) {
    return `<h3>1. Field of view</h3>${why}
      <p>FOV stays at <b>${esc(fmt(match.fov.value, 4))}</b> (<span class="mono">${esc(match.fov.key)}</span>), because Kirb doesn't know this game's FOV type.</p>`;
  }
  const t = match.fovTarget;
  const same = Math.abs(t.value - match.fov.value) < 0.01;
  const setFirst = S.prefs.fov.enabled || d.fovAffectsSens === true;
  return `<h3>1. Field of view</h3>${why}
    <div class="choices">
      <label class="toggle"><input type="radio" name="cFovMode" value="set" ${setFirst ? 'checked' : ''} />
        <span>Set it to <b>${esc(fmt(t.value, 4))}</b>, your ${esc(S.prefs.fov.value)} (${esc(FOV_TYPES[S.prefs.fov.type])})${same ? ' <span class="mute">(already set)</span>' : ''}</span></label>
      <label class="toggle"><input type="radio" name="cFovMode" value="keep" ${setFirst ? '' : 'checked'} />
        <span>Keep it at <b>${esc(fmt(match.fov.value, 4))}</b></span></label>
    </div>
    ${t.warning ? `<p class="warn">${esc(t.warning)}</p>` : ''}`;
}

function calibratePanel(d, match) {
  const p = presetById(d.preset);
  const target = `${S.prefs.cm360} cm/360 at ${S.prefs.dpi} DPI`;
  const fovLine = match.fov
    ? `<li class="ok">FOV: <span class="mono">${esc(match.fov.key)}</span> = <b>${esc(fmt(match.fov.value, 4))}</b></li>`
    : '';
  return `
    <div class="importbox found">
      <b>Found your current setting</b>${match.source === 'search' ? ' <span class="mute">(the paste didn\'t name a file, so Kirb sniffed around for it)</span>' : ''}
      <p class="mono" style="font-size:12px">${esc(match.file)}${match.files.length > 1 ? ` <span class="mute">(+${match.files.length - 1} more)</span>` : ''}</p>
      <ul class="importlist">
        <li class="ok">${esc(d.sens.name)}: <span class="mono">${esc(match.sens.key)}</span> = <b>${esc(fmt(match.sens.value, 6))}</b> <span class="mute">(matched by ${esc(match.sens.why)})</span></li>
        ${match.sensAlso.map((k) => `<li class="ok"><span class="mono">${esc(k.key)}</span> = ${esc(fmt(k.value, 6))}, kept the same so vertical matches horizontal</li>`).join('')}
        ${fovLine}
      </ul>
      ${fovStep(d, match)}
      <h3>${match.fov ? '2. ' : ''}Calibrate to your target</h3>
      ${p
        ? `<p>Using the <b>${esc(p.name)}</b> preset (yaw ${esc(p.yaw)}), so no value is needed. Your target is <b>${esc(target)}</b>.</p>`
        : `<p>In the calculator, convert your <b>${esc(target)}</b> to ${esc(d.name)}${match.fov ? ' at the FOV above' : ''} and copy the sensitivity it gives you:</p>
           ${calcHelp(d.name, match.fov ? fmt(defaultFov(d, match), 4) : null)}
           <div class="row"><input id="cVal" type="number" step="any" placeholder="e.g. 3.2" style="width:140px" />
             <label class="toggle"><input type="checkbox" id="cExact" ${d.exact ? 'checked' : ''} /> <span>Use this exact number, never recalculate</span></label></div>`}
      <p id="cNow" class="mono" style="font-size:12px"></p>
      <p>Close the game first: it rewrites this file when it exits. Kirb backs the file up before writing.</p>
      <div class="row" style="margin-top:10px">
        <button id="cApply" class="primary">Calibrate and apply</button>
        <button id="cSave">Save without applying</button>
        <button id="cEdit" class="ghost">Edit details…</button>
      </div>
    </div>`;
}

function wireCalibrate(d, match) {
  const p = presetById(d.preset);
  const now = match.sens.value;
  const showNow = () => {
    const v = parseFloat($('#cVal')?.value);
    const exact = $('#cExact')?.checked;
    let cm = null;
    if (p) cm = (360 / (p.yaw * S.prefs.dpi * now)) * 2.54;
    else if (v > 0 && !exact && now > 0) cm = (S.prefs.cm360 * v) / now; // sensitivity scales with 1/cm
    $('#cNow').textContent = cm ? `Your current ${fmt(now, 4)} works out to about ${fmt(cm, 2)} cm/360. After applying: ${p ? fmt((360 / (p.yaw * S.prefs.dpi * S.prefs.cm360)) * 2.54, 4) : fmt(v, 6)}.` : '';
  };
  $('#cVal')?.addEventListener('input', showNow);
  $('#cExact')?.addEventListener('change', showNow);
  showNow();
  // the FOV copy button follows the FOV choice
  document.querySelectorAll('input[name=cFovMode]').forEach((r) => r.addEventListener('change', () => {
    const chip = $('#fovChip');
    if (!chip) return;
    const f = fmt(chosenFov(d, match), 4);
    chip.dataset.copy = f;
    chip.innerHTML = `FOV ${esc(f)} <span>⧉</span>`;
  }));

  const save = async (applyNow) => {
    const v = parseFloat($('#cVal')?.value);
    if (!p && !(v > 0)) return $('#cVal').focus();
    const input = {
      name: d.name, sensFiles: match.files, sensKeys: [match.sens.key, ...match.sensAlso.map((k) => k.key)],
      sensRange: [d.sens.min, d.sens.max], notes: d.summary, yaw: p ? p.yaw : undefined,
      fovAffectsSens: d.fovAffectsSens === true,
    };
    if (match.fov && d.fovType && d.fov) Object.assign(input, { fovKey: match.fov.key, fovType: d.fovType, fovRange: [d.fov.min, d.fov.max], fovDecimals: d.fov.decimals });
    S = await api.saveCustomGame(input);
    const g = S.games.find((x) => x.name === d.name);
    if (!g) return;
    const fov = chosenFov(d, match);
    const patch = {};
    if (canSetFov(d, match)) {
      const set = $('input[name=cFovMode]:checked')?.value === 'set';
      Object.assign(patch, set ? { fovMatch: true, keepFov: null } : { keepFov: true, fovMatch: null });
    }
    if (!p) {
      Object.assign(patch, $('#cExact').checked
        ? { manualSens: v, calibration: null }
        : { calibration: { sens: v, cm360: S.prefs.cm360, dpi: S.prefs.dpi, ...(fov != null ? { fov } : {}) }, manualSens: null });
    }
    if (Object.keys(patch).length) S = await api.setGamePrefs(g.id, patch);
    closeModal(); renderGames();
    if (applyNow) await doApply([g.id]);
    else log(`<span class="ok">${esc(d.name)} saved. Click Apply when the game is closed.</span>`);
  };
  $('#cApply').addEventListener('click', () => save(true));
  $('#cSave').addEventListener('click', () => save(false));
  $('#cEdit').addEventListener('click', () => pickFile(match.file, { draft: d, files: match.files, match }));
}

/** Pre-pick the scaling method the import suggests. */
function suggestScaling(root, d) {
  const tab = (t) => root.querySelector(`[data-tab="${t}"]`)?.click();
  if (d.exact) { tab('paste'); $('#pasteFixed', root).checked = true; }
  else if (d.preset && presetById(d.preset)) {
    tab('preset');
    const sel = $('#presetSel', root); sel.value = d.preset; sel.dispatchEvent(new Event('change'));
  }
  if (d.fovType && $('#wFovType')) $('#wFovType').value = d.fovType; // the paste beats the preset's guess
}

/** Games the paste says are set in-game: no file, just the value to type. */
function manualStep(d) {
  W.imp = { draft: d, files: [] };
  $('#wStep2').innerHTML = `
    <h3>Type-in-game game</h3>
    <p>${esc(d.summary)}</p>
    <div class="row" style="margin-top:8px">Name in list <input type="text" id="wGameName" value="${esc(d.name)}" /></div>
    ${d.fov ? (d.fovType
      ? `<p>Kirb will also work out the value for <span class="mono">${esc(d.fov.name)}</span> (${esc(FOV_TYPES[d.fovType])}).</p>`
      : '<p class="warn">FOV won\'t be calculated, because Kirb doesn\'t know this game\'s FOV type.</p>') : ''}
    ${scalingBlock(null)}
    <div class="foot"><button id="wSaveManual" class="primary">Save game</button></div>`;
  const root = $('#wStep2');
  wireTabs(root);
  suggestScaling(root, d);
  $('#wSaveManual').addEventListener('click', async () => {
    const gname = $('#wGameName').value.trim();
    if (!gname) return alert('Give the game a name.');
    const sc = readScaling(root);
    S = await api.saveCustomGame({
      manual: true, name: gname, notes: d.summary,
      sensRange: [d.sens.min, d.sens.max], sensDecimals: Math.max(2, d.sens.decimals),
      fovType: d.fovType || undefined, fovRange: d.fov ? [d.fov.min, d.fov.max] : undefined, fovDecimals: d.fov ? d.fov.decimals : undefined,
      yaw: sc && sc.yaw ? sc.yaw : undefined,
    });
    const created = S.games.find((g) => g.name === gname);
    if (sc && !sc.yaw && created) S = await api.setGamePrefs(created.id, sc.patch);
    closeModal(); renderGames();
    if (!sc) log(`<span class="warn">${esc(gname)} added. Open "Set up" to tell it how the sensitivity scales.</span>`);
  });
  root.scrollIntoView({ behavior: 'smooth' });
}

async function pickFile(file, imp = null) {
  const r = await api.scanFile(file);
  W.file = file; W.keys = r.keys; W.imp = imp;
  const d = imp && imp.draft;
  const same = (k, name) => !!name && k.key.toLowerCase() === name.toLowerCase();
  // the imported keys go to the top of their lists, even if their names don't look like sens/FOV
  const mt = imp && imp.match;
  const iSens = mt ? r.keys.find((k) => k.key === mt.sens.key) : d && d.sens ? r.keys.find((k) => same(k, d.sens.name)) : null;
  const iFov = mt ? (mt.fov ? r.keys.find((k) => k.key === mt.fov.key) : null) : d && d.fov ? r.keys.find((k) => same(k, d.fov.name)) : null;
  W.impKeys = { sens: iSens && iSens.key, fov: iFov && iFov.key };
  const sensKeys = [iSens, ...r.keys.filter((k) => k.kind === 'sens' && k !== iSens && k !== iFov)].filter(Boolean);
  const fovKeys = [iFov, ...r.keys.filter((k) => k.kind === 'fov' && k !== iFov && k !== iSens)].filter(Boolean);
  const others = r.keys.filter((k) => !sensKeys.includes(k) && !fovKeys.includes(k));
  const id = (k) => `${k.key}|${k.section || ''}`;
  W.sensKey = sensKeys[0] ? id(sensKeys[0]) : null;
  W.fovKey = iFov ? id(iFov) : null;
  const row = (k, group) => {
    const v = id(k);
    const checked = v === (group === 'sens' ? W.sensKey : W.fovKey);
    return `<tr><td><input type="radio" name="${group}" value="${esc(v)}" ${checked ? 'checked' : ''}></td>
      <td class="mono">${esc(k.key)}</td><td class="mono">${esc(k.value)}</td><td>${esc(k.section || '')}</td></tr>`;
  };
  const missing = d ? [d.sens && !iSens && d.sens.name, d.fov && !iFov && d.fov.name].filter(Boolean) : [];
  $('#wStep2').innerHTML = `
    ${d ? `<p class="imported">Filled in from mouse-sensitivity.com. Check it, then save.${imp.files.length > 1 ? ` Kirb will write to all ${imp.files.length} config files it found.` : ''}</p>` : ''}
    ${missing.length ? `<p class="warn">Not in this file yet: ${missing.map((m) => `<span class="mono">${esc(m)}</span>`).join(', ')}. Change the setting in-game once so the game writes it, then add the game again.</p>` : ''}
    <h3>Which setting is your mouse sensitivity?</h3>
    <p class="mono" style="font-size:12px">${esc(file)}</p>
    ${r.readOnly ? '<p style="color:var(--warn)">This is a binary save file. Kirb can read your current sensitivity from it and work out the value you need, but you\'ll type that value in-game. Writing to save files can corrupt them.</p>' : ''}
    ${r.keys.length ? `<table class="keytable"><tr><th></th><th>Setting</th><th>Current</th><th>Section</th></tr>
      ${sensKeys.map((k) => row(k, 'sens')).join('')}
      ${others.length ? `<tr><td colspan="4"><button class="link small" id="showOthers">show ${others.length} other number${others.length > 1 ? 's' : ''}</button></td></tr>` : ''}
      <tbody id="otherRows" class="hidden">${others.map((k) => row(k, 'sens')).join('')}</tbody></table>`
      : '<p style="color:var(--warn)">No numeric settings found in this file. It may be the wrong file, or a binary format Kirb can\'t edit.</p>'}
    <h3>Field of view (optional)</h3>
    <table class="keytable"><tr><th></th><th>Setting</th><th>Current</th><th>Section</th></tr>
      <tr><td><input type="radio" name="fov" value="" ${W.fovKey ? '' : 'checked'}></td><td colspan="3">Don't change FOV</td></tr>
      ${[...fovKeys, ...others].map((k) => row(k, 'fov')).join('')}</table>
    <div class="row" style="margin-top:8px">This game's FOV number is
      <select id="wFovType">${Object.entries(FOV_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <span style="color:var(--mute);font-size:12px">(not sure? mouse-sensitivity.com lists it for each game)</span></div>
    <div class="row" style="margin-top:12px">Name in list <input type="text" id="wGameName" value="${esc(d ? d.name : W.name)}" /></div>
    <div class="row" style="margin-top:8px">Game .exe (optional, so it can warn you if the game is running) <input type="text" id="wExe" placeholder="e.g. Discovery.exe" style="max-width:220px" /></div>
    ${scalingBlock(null)}
    <div class="foot"><button id="wSave" class="primary">Save game</button></div>`;
  $('#showOthers')?.addEventListener('click', (e) => { e.target.closest('tr').remove(); $('#otherRows').classList.remove('hidden'); });
  wireTabs($('#wStep2'));
  if (d) suggestScaling($('#wStep2'), d);
  $('#wSave').addEventListener('click', saveWizard);
  $('#wStep2').scrollIntoView({ behavior: 'smooth' });
}

async function saveWizard() {
  const root = $('#wStep2');
  const sens = root.querySelector('input[name=sens]:checked');
  const fov = root.querySelector('input[name=fov]:checked');
  const gname = $('#wGameName').value.trim();
  if (!sens) return alert('Pick which setting is your mouse sensitivity.');
  if (!gname) return alert('Give the game a name.');
  const [sensKey, sensSection] = sens.value.split('|');
  const [fovKey, fovSection] = (fov && fov.value ? fov.value : '|').split('|');
  const sc = readScaling(root);
  const input = {
    name: gname, sensFile: W.file, sensKey, sensSection: sensSection || undefined,
    fovFile: fovKey ? W.file : undefined, fovKey: fovKey || undefined, fovSection: fovSection || undefined, fovType: $('#wFovType').value,
    process: $('#wExe').value.trim() || undefined,
    yaw: sc && sc.yaw ? sc.yaw : undefined, // a plain yaw goes in the profile itself
    notes: `Added by you · ${W.file.split(/[\\/]/).pop()} → ${sensKey}${fovKey ? `, ${fovKey}` : ''}`,
  };
  const d = W.imp && W.imp.draft;
  if (d) {
    // write every copy the import found (e.g. single-player and multiplayer configs)
    if (W.imp.files.length > 1 && W.imp.files.includes(W.file)) input.sensFiles = W.imp.files;
    if (d.sens && sensKey === W.impKeys.sens) {
      input.sensRange = [d.sens.min, d.sens.max];
      const mt = W.imp.match;
      if (mt && mt.sens.key === sensKey) input.sensKeys = [sensKey, ...mt.sensAlso.map((k) => k.key)];
    }
    if (d.fov && fovKey && fovKey === W.impKeys.fov) { input.fovRange = [d.fov.min, d.fov.max]; input.fovDecimals = d.fov.decimals; }
    input.notes = d.summary;
  }
  S = await api.saveCustomGame(input);
  const created = S.games.find((g) => g.name === gname);
  if (sc && !sc.yaw && created) S = await api.setGamePrefs(created.id, sc.patch);
  closeModal(); renderGames();
  if (!sc) log(`<span class="warn">${esc(gname)} added. Open "Set up" to tell it how the sensitivity scales before you apply.</span>`);
}

// ---------------- boot ----------------
async function refresh() { S = await api.state(); renderGames(); }
(async () => { S = await api.state(); fillAim(); renderGames(); })();
