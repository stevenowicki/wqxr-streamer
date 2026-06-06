'use strict';

const { ipcMain, shell } = require('electron');
const { STREAMS } = require('./streams');
const nowplaying = require('./nowplaying');

// Hosts we'll hand off to the system browser. Links in the now-playing data all
// point at WQXR/WNYC (and ArkivMusic for recordings); anything else is ignored.
const ALLOWED_LINK_HOSTS = ['wqxr.org', 'wnyc.org', 'arkivmusic.com'];

function isAllowedLink(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return ALLOWED_LINK_HOSTS.some(
      (host) => u.hostname === host || u.hostname.endsWith(`.${host}`)
    );
  } catch (_) {
    return false;
  }
}

// `controller` is defined in main.js and owns app-level playback state.
function registerIpc(controller) {
  ipcMain.handle('app:getInitialState', () => ({
    streams: STREAMS.map(({ id, name, description, mp3, aac }) => ({ id, name, description, mp3, aac })),
    streamId: controller.streamId,
    volume: controller.volume,
    muted: controller.muted,
    autoplay: controller.autoplay,
    isPlaying: controller.isPlaying,
    nowplaying: nowplaying.state,
  }));

  // From views (user intents).
  ipcMain.on('ui:toggle', () => controller.togglePlay());
  ipcMain.on('ui:setStream', (_e, id) => controller.setStream(id));
  ipcMain.on('ui:setVolume', (_e, v) => controller.setVolume(v));
  ipcMain.on('ui:setMuted', (_e, m) => controller.setMuted(m));
  ipcMain.on('ui:openMainWindow', () => controller.openMainWindow());
  ipcMain.on('ui:openLink', (_e, url) => {
    if (typeof url === 'string' && isAllowedLink(url)) shell.openExternal(url);
  });

  // From the engine (authoritative playback state).
  ipcMain.on('engine:playback', (_e, payload) => {
    controller.setPlaying(!!(payload && payload.isPlaying));
  });
}

module.exports = { registerIpc, isAllowedLink };
