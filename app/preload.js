'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = async (name, ...args) => {
  const r = await ipcRenderer.invoke(name, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('api', {
  state: () => call('state'),
  savePrefs: (p) => call('savePrefs', p),
  setGamePrefs: (id, patch) => call('setGamePrefs', id, patch),
  preview: (id) => call('preview', id),
  apply: (id, force) => call('apply', id, force),
  restore: (id) => call('restore', id),
  discover: (q) => call('discover', q),
  scanFile: (f) => call('scanFile', f),
  importText: (t) => call('importText', t),
  openCalculator: () => call('openCalculator'),
  installUpdate: () => call('installUpdate'),
  appVersion: () => call('appVersion'),
  refreshCommunity: () => call('refreshCommunity'),
  shareGame: (id, note) => call('shareGame', id, note),
  reportUrl: (id) => call('reportUrl', id),
  onUpdate: (cb) => { ipcRenderer.on('update', (_e, s) => cb(s)); },
  onCommunityUpdated: (cb) => { ipcRenderer.on('community-updated', (_e, n) => cb(n)); },
  closeCalculator: () => call('closeCalculator'),
  sideNav: (a) => call('sideNav', a),
  onSidePanel: (cb) => { ipcRenderer.on('side-panel', (_e, s) => cb(s)); },
  watchClipboard: (on) => call('watchClipboard', on),
  onClipboard: (cb) => { ipcRenderer.on('clipboard', (_e, hit) => cb(hit)); },
  adopt: (id) => call('adopt', id),
  chooseFile: (title) => call('chooseFile', title),
  saveCustomGame: (g) => call('saveCustomGame', g),
  deleteCustomGame: (id) => call('deleteCustomGame', id),
  showFile: (p) => call('showFile', p),
  openExternal: (u) => call('openExternal', u),
  yawFrom: (s, d, c) => call('yawFrom', s, d, c),
});
