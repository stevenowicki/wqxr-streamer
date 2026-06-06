'use strict';

const path = require('path');
const { app, BrowserWindow, screen } = require('electron');

// Two hosts for the same renderer:
//   - popover: frameless, hidden-by-default, toggled from the tray icon.
//   - main:    a normal resizable window opened on demand.
// Both load renderer/index.html and differ only by the ?mode= query string.

const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const INDEX = path.join(__dirname, '..', 'renderer', 'index.html');

let popover = null;
let mainWindow = null;
let engine = null;
let quitting = false;
let lastShownAt = 0; // guards against the immediate blur right after a show
let lastHiddenAt = 0; // lets a tray-click that dismisses via blur not re-open

// Called by main.js on before-quit so close handlers know to actually close.
function setQuitting() {
  quitting = true;
}

function commonWebPrefs() {
  return {
    preload: PRELOAD,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false, // preload uses require()
    backgroundThrottling: false, // keep audio/polling steady when hidden
  };
}

// Forward renderer console + crashes to the main process stdout when
// WQXR_DEBUG is set — handy for development; silent in normal use.
function attachDebug(win, label) {
  if (!process.env.WQXR_DEBUG) return;
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    console.log(`[renderer:${label}] ${message}  (${source}:${line})`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log(`[renderer:${label}] GONE: ${JSON.stringify(details)}`);
  });
}

// The hidden, persistent audio engine — created once at launch, never shown.
// Owns the only <audio> element and OS media session in the app.
function createEngine() {
  engine = new BrowserWindow({
    show: false,
    webPreferences: commonWebPrefs(),
  });
  engine.loadFile(path.join(__dirname, '..', 'renderer', 'engine.html'), {
    query: { mode: 'engine' },
  });
  attachDebug(engine, 'engine');
  return engine;
}

function sendToEngine(channel, payload) {
  if (engine && !engine.isDestroyed()) engine.webContents.send(channel, payload);
}

function createPopover() {
  popover = new BrowserWindow({
    width: 360,
    height: 540,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    // No alwaysOnTop: an always-on-top window floats as a panel that doesn't
    // reliably lose focus, so blur-to-hide (click-away) never fires.
    webPreferences: commonWebPrefs(),
  });
  popover.loadFile(INDEX, { query: { mode: 'popover' } });
  attachDebug(popover, 'popover');

  // Hide when it loses focus so it behaves like a real menu-bar popover. Ignore
  // the spurious blur that fires immediately after a programmatic show (e.g. on
  // launch, before the app is frontmost) — otherwise it would never appear.
  popover.on('blur', () => {
    if (process.env.WQXR_DEBUG) {
      console.log(`[popover] blur fired (sinceShown=${Date.now() - lastShownAt}ms, visible=${popover.isVisible()})`);
    }
    if (Date.now() - lastShownAt < 400) return;
    if (popover && popover.isVisible() && !popover.webContents.isDevToolsFocused()) {
      popover.hide();
      lastHiddenAt = Date.now();
    }
  });
  return popover;
}

function getPopover() {
  if (!popover || popover.isDestroyed()) createPopover();
  return popover;
}

// Position the popover just beneath (macOS) or above (Windows tray) the icon.
function positionPopoverNear(trayBounds) {
  const win = getPopover();
  const { width, height } = win.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x || 0,
    y: trayBounds.y || 0,
  });
  const work = display.workArea;

  let x = Math.round((trayBounds.x || work.x + work.width) + (trayBounds.width || 0) / 2 - width / 2);
  let y;
  if (process.platform === 'darwin') {
    y = Math.round((trayBounds.y || work.y) + (trayBounds.height || 0) + 4);
  } else {
    // Windows/Linux tray usually sits at the bottom — open upward.
    y = Math.round(work.y + work.height - height - 8);
    if (!trayBounds.x) x = Math.round(work.x + work.width - width - 8);
  }
  // Keep fully on-screen.
  x = Math.max(work.x + 4, Math.min(x, work.x + work.width - width - 4));
  y = Math.max(work.y + 4, Math.min(y, work.y + work.height - height - 4));
  win.setPosition(x, y, false);
}

function togglePopover(trayBounds) {
  const win = getPopover();
  if (win.isVisible()) {
    win.hide();
    lastHiddenAt = Date.now();
    return;
  }
  // If a blur from this very click just hid the popover, don't immediately
  // re-open it — the user clicked the icon to dismiss.
  if (Date.now() - lastHiddenAt < 300) return;
  showPopover(trayBounds);
}

function showPopover(trayBounds) {
  const win = getPopover();
  if (trayBounds) positionPopoverNear(trayBounds);
  lastShownAt = Date.now();
  // Activate the app so the frameless window becomes key — otherwise (with no
  // dock icon) it never gains focus, and clicking away never blurs it shut.
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.show();
  win.focus();
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    width: 400,
    height: 660,
    minWidth: 360,
    minHeight: 520,
    title: 'WQXR Streamer',
    show: false,
    webPreferences: commonWebPrefs(),
  });
  mainWindow.loadFile(INDEX, { query: { mode: 'window' } });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Closing the window hides it to the tray (audio keeps playing); it only
  // truly closes when the app is quitting.
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  return mainWindow;
}

function getMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

// Broadcast a message to every live renderer (popover + main window).
function broadcast(channel, payload) {
  for (const win of [popover, mainWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

module.exports = {
  createEngine,
  sendToEngine,
  createPopover,
  getPopover,
  togglePopover,
  showPopover,
  positionPopoverNear,
  createMainWindow,
  getMainWindow,
  broadcast,
  setQuitting,
};
