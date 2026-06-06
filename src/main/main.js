'use strict';

const { app } = require('electron');
const store = require('./store');
const { getStream } = require('./streams');
const nowplaying = require('./nowplaying');
const windows = require('./windows');
const tray = require('./tray');
const { registerIpc } = require('./ipc');

// Single-instance lock — a second launch just surfaces the popover instead of
// spawning a duplicate tray icon / audio stream.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let isQuitting = false;

// The controller owns app-level playback state and is the seam between the tray,
// the now-playing poller, and the renderer windows.
const controller = {
  streamId: store.get('streamId'),
  volume: store.get('volume'),
  muted: store.get('muted'),
  autoplay: store.get('autoplay'),
  isPlaying: false, // reflects the engine's actual playback state

  // Push the view-facing state (selector, play button, volume) to all windows.
  broadcastState() {
    windows.broadcast('state', {
      streamId: this.streamId,
      isPlaying: this.isPlaying,
      volume: this.volume,
      muted: this.muted,
    });
  },

  togglePlay() {
    windows.sendToEngine('engine:command', this.isPlaying ? 'stop' : 'play');
  },

  // Called by the engine — the single source of truth for real playback state.
  setPlaying(playing) {
    if (this.isPlaying === playing) return;
    this.isPlaying = playing;
    tray.update();
    this.broadcastState();
  },

  setStream(id) {
    const stream = getStream(id);
    if (stream.id !== this.streamId) {
      this.streamId = stream.id;
      store.set({ streamId: stream.id });
      nowplaying.setStream(stream.id);
      windows.sendToEngine('engine:setStream', stream.id);
    }
    this.broadcastState();
    tray.update();
  },

  setVolume(v) {
    const vol = Math.max(0, Math.min(1, Number(v) || 0));
    this.volume = vol;
    if (vol > 0) this.muted = false;
    store.set({ volume: vol, muted: this.muted });
    windows.sendToEngine('engine:setVolume', vol);
    windows.sendToEngine('engine:setMuted', this.muted);
    this.broadcastState();
  },

  setMuted(m) {
    this.muted = !!m;
    store.set({ muted: this.muted });
    windows.sendToEngine('engine:setMuted', this.muted);
    this.broadcastState();
  },

  setAutoplay(on) {
    this.autoplay = !!on;
    store.set({ autoplay: this.autoplay });
    tray.update();
  },

  openMainWindow() {
    windows.createMainWindow();
  },

  togglePopover(bounds) {
    windows.togglePopover(bounds);
  },

  currentTrackLabel() {
    const t = nowplaying.current && nowplaying.current.track;
    if (!t) return null;
    if (t.composer && t.title) return `${t.composer} — ${t.title}`;
    return t.title || t.composer || null;
  },

  quit() {
    isQuitting = true;
    app.quit();
  },
};

// Poll for valid, *stable* tray bounds, then pop the player under the icon.
// At launch macOS reports transitional bounds (e.g. height 0 at a default
// corner) before the menu-bar item settles, and those map to the wrong display.
// Requiring two consecutive identical sane readings avoids trusting them.
let lastBoundsStr = null;
function presentOnLaunch(attempt = 0) {
  const b = tray.getBounds();
  const sane = b && b.width > 0 && b.height >= 16;
  const str = sane ? `${b.x},${b.y},${b.width},${b.height}` : null;
  if (sane && str === lastBoundsStr) {
    windows.showPopover(b); // stable across two reads — safe to position
  } else if (attempt < 30) {
    lastBoundsStr = str;
    setTimeout(() => presentOnLaunch(attempt + 1), 100);
  } else {
    windows.showPopover(sane ? b : null); // best effort after ~3s
  }
}

function broadcastNowPlaying(state) {
  windows.broadcast('state:nowplaying', state); // views render the card
  windows.sendToEngine('state:nowplaying', state); // engine updates media session
  tray.update();
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide(); // menu-bar-first; the full window is opened on demand
  }

  registerIpc(controller);
  windows.createEngine(); // the single audio owner, created before any view
  windows.createPopover();
  tray.createTray(controller);

  // Surface the player on first launch so the user can see the app is running,
  // positioned right under the menu-bar icon (as if they'd clicked it).
  // macOS may not have laid out the tray icon yet, so its bounds are still
  // zero-size; wait for real bounds before showing, otherwise the positioning
  // math falls back to a screen corner (possibly on another display).
  presentOnLaunch();

  nowplaying.on('update', broadcastNowPlaying);
  await nowplaying.setStream(controller.streamId);
});

// Re-show the popover if the user launches the app again.
app.on('second-instance', () => {
  windows.togglePopover(null);
});

// Don't quit when all windows are closed — we live in the tray.
app.on('window-all-closed', (e) => {
  // No-op: keep running so audio + tray persist. Quit only via the tray menu.
});

// macOS: hide the main window to the tray instead of quitting when it's closed.
app.on('before-quit', () => {
  isQuitting = true;
  windows.setQuitting();
  nowplaying.stop();
});

// Surface the popover when the dock icon is clicked (if the dock is ever shown).
app.on('activate', () => {
  windows.togglePopover(null);
});

module.exports = { controller, isQuitting: () => isQuitting };
