'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The single, locked-down surface every renderer is allowed to touch. No Node,
// no raw ipcRenderer. Both the visible views (popover / window) and the hidden
// audio engine load this same bridge and use the subset they need.
contextBridge.exposeInMainWorld('wqxr', {
  // "popover", "window", or "engine" (from the ?mode= query string).
  mode: new URLSearchParams(location.search).get('mode') || 'window',

  getInitialState: () => ipcRenderer.invoke('app:getInitialState'),

  // --- view -> main (user intents) ---
  toggle: () => ipcRenderer.send('ui:toggle'),
  setStream: (id) => ipcRenderer.send('ui:setStream', id),
  setVolume: (v) => ipcRenderer.send('ui:setVolume', v),
  setMuted: (m) => ipcRenderer.send('ui:setMuted', m),
  openLink: (url) => ipcRenderer.send('ui:openLink', url),
  openMainWindow: () => ipcRenderer.send('ui:openMainWindow'),

  // --- engine -> main (authoritative playback state) ---
  reportPlayback: (isPlaying) => ipcRenderer.send('engine:playback', { isPlaying }),

  // --- main -> view ---
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  onNowPlaying: (cb) => ipcRenderer.on('state:nowplaying', (_e, np) => cb(np)),

  // --- main -> engine ---
  onEngineCommand: (cb) => ipcRenderer.on('engine:command', (_e, cmd) => cb(cmd)),
  onEngineSetStream: (cb) => ipcRenderer.on('engine:setStream', (_e, id) => cb(id)),
  onEngineSetVolume: (cb) => ipcRenderer.on('engine:setVolume', (_e, v) => cb(v)),
  onEngineSetMuted: (cb) => ipcRenderer.on('engine:setMuted', (_e, m) => cb(m)),
});
