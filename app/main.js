'use strict';
const { app, BrowserWindow, WebContentsView, Menu, ipcMain, dialog, shell, clipboard, screen } = require('electron');
const path = require('path');
const E = require('../core/engine');
const L = require('../core/locate');
const MS = require('../core/msimport');
const { makeHandlers } = require('./handlers');

const APP_NAME = "Kirb's Sensitivity Syncer";
const MS_URL = 'https://www.mouse-sensitivity.com/';

// Settings, custom games and backups stay in the folder the app used when it was called SensSync
app.setPath('userData', path.join(app.getPath('appData'), 'SensSync'));
app.setName(APP_NAME);

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1060, height: 800, minWidth: 820, minHeight: 560,
    backgroundColor: '#1d1612',
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', 'kirby-icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('resize', layoutSide);
}

// ---------------- mouse-sensitivity.com in a side panel ----------------
// The user drives the site; the app never fills in or reads the page. Its own persistent
// session keeps the user signed in between launches.
const BAR = 44; // height of the panel's header bar, drawn by the app's page
let side = null; // { view, width, grew }

function sideWidth() {
  const [w] = win.getContentSize();
  return Math.round(Math.min(900, Math.max(520, w * 0.5)));
}

function layoutSide() {
  if (!side || !win) return;
  const [w, h] = win.getContentSize();
  side.width = sideWidth();
  side.view.setBounds({ x: w - side.width, y: BAR, width: side.width, height: Math.max(0, h - BAR) });
  win.webContents.send('side-panel', { open: true, width: side.width, bar: BAR });
}

function openCalculator() {
  if (side) { layoutSide(); return true; }
  // make room for the panel by widening the window, when the screen allows it
  let grew = 0;
  if (!win.isMaximized()) {
    const b = win.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const width = Math.min(area.width, b.width + 640);
    grew = width - b.width;
    if (grew > 0) win.setBounds({ x: Math.max(area.x, Math.min(b.x, area.x + area.width - width)), y: b.y, width, height: b.height });
  }
  const view = new WebContentsView({
    webPreferences: { partition: 'persist:mouse-sensitivity', contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  view.setBackgroundColor('#1b1b1b');
  // links that try to open new windows go to the normal browser
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // right-click copy/paste, since embedded pages don't get a menu by default
  view.webContents.on('context-menu', (_e, p) => {
    Menu.buildFromTemplate([
      { role: 'copy', enabled: !!p.selectionText },
      { role: 'paste', enabled: p.isEditable },
      { type: 'separator' },
      { role: 'selectAll' },
    ]).popup({ window: win });
  });
  win.contentView.addChildView(view);
  side = { view, width: 0, grew };
  layoutSide();
  view.webContents.loadURL(MS_URL);
  return true;
}

function closeCalculator() {
  if (!side) return false;
  const { view, grew } = side;
  side = null;
  win.contentView.removeChildView(view);
  view.webContents.close();
  if (grew > 0 && !win.isMaximized()) {
    const b = win.getBounds();
    win.setBounds({ ...b, width: Math.max(820, b.width - grew) });
  }
  win.webContents.send('side-panel', { open: false, width: 0, bar: BAR });
  return true;
}

function sideNav(action) {
  if (!side) return false;
  const wc = side.view.webContents;
  if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  if (action === 'reload') wc.reload();
  if (action === 'home') wc.loadURL(MS_URL);
  if (action === 'external' && /^https:\/\//.test(wc.getURL())) shell.openExternal(wc.getURL());
  return true;
}

// Watch the clipboard while a dialog is open, and pass on anything the user copied that
// looks like a Game Info box or a sensitivity number. Nothing else is kept or sent anywhere.
let clipTimer = null;
let lastClip = '';
function watchClipboard(on) {
  clearInterval(clipTimer);
  clipTimer = null;
  if (!on) return false;
  lastClip = clipboard.readText(); // ignore whatever was already there
  clipTimer = setInterval(() => {
    const text = clipboard.readText();
    if (text === lastClip) return;
    lastClip = text;
    const hit = MS.classifyClipboard(text);
    if (hit && win && !win.isDestroyed()) win.webContents.send('clipboard', hit);
  }, 400);
  return true;
}

// ---------------- auto-update from GitHub Releases (installed app only) ----------------
let updater = null;
function setupUpdates() {
  if (!app.isPackaged) return;
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch { return; }
  const send = (s) => { if (win && !win.isDestroyed()) win.webContents.send('update', s); };
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-available', (i) => send({ state: 'downloading', version: i.version }));
  updater.on('update-downloaded', (i) => send({ state: 'ready', version: i.version }));
  updater.on('error', () => { /* offline or no releases yet: try again next launch */ });
  updater.checkForUpdates().catch(() => {});
}

app.whenReady().then(() => {
  const st = E.store(app.getPath('userData'));
  const handlers = makeHandlers(st, () => L.makeContext(), {
    chooseFile: async (title) => {
      const r = await dialog.showOpenDialog(win, { title: title || "Choose the game's config file", properties: ['openFile', 'showHiddenFiles'] });
      return r.canceled ? null : r.filePaths[0];
    },
    showFile: (p) => shell.showItemInFolder(p),
    openExternal: (u) => shell.openExternal(u),
    openCalculator,
    closeCalculator,
    sideNav,
    watchClipboard,
    installUpdate: () => { if (updater) updater.quitAndInstall(); return !!updater; },
    appVersion: () => app.getVersion(),
  });
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(name, async (_e, ...args) => {
      try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message }; }
    });
  }
  createWindow();
  win.webContents.once('did-finish-load', () => {
    setupUpdates();
    // fetch the latest shared game library; the list refreshes when it arrives
    handlers.refreshCommunity().then((n) => { if (n && !win.isDestroyed()) win.webContents.send('community-updated', n); }).catch(() => {});
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
