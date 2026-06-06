'use strict';

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');
const { STREAMS } = require('./streams');

// The always-present menu-bar / system-tray presence. Left-click toggles the
// popover (where supported); the context menu offers play/pause, the stream
// switcher, the full window, and quit. The tooltip shows the current piece.

const PULSE_FRAMES = 10;
const PULSE_INTERVAL_MS = 170; // ~1.7s per breath

let tray = null;
let controller = null;
let contextMenu = null;
let baseImage = null;
let pulseImages = null;
let pulseTimer = null;
let pulseIdx = 0;

function asset(file) {
  return path.join(__dirname, '..', '..', 'assets', file);
}

function trayImage() {
  // macOS uses a monochrome "template" image that auto-adapts to light/dark
  // menu bars; other platforms use a normal colored icon.
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const img = nativeImage.createFromPath(asset(file));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

// Breathing "now playing" frames (macOS menu bar only). Loaded once.
function pulseFrames() {
  if (pulseImages) return pulseImages;
  pulseImages = [];
  for (let i = 0; i < PULSE_FRAMES; i += 1) {
    const img = nativeImage.createFromPath(asset(`anim/pulse-${i}.png`));
    img.setTemplateImage(true);
    pulseImages.push(img);
  }
  return pulseImages;
}

// Gently pulse the wordmark while audio is playing so it's obvious where the
// sound is coming from. Static (resting) image when stopped.
function startPulse() {
  if (process.platform !== 'darwin' || pulseTimer) return;
  const frames = pulseFrames();
  pulseIdx = 0;
  pulseTimer = setInterval(() => {
    if (!tray) return;
    tray.setImage(frames[pulseIdx]);
    pulseIdx = (pulseIdx + 1) % frames.length;
  }, PULSE_INTERVAL_MS);
}

function stopPulse() {
  if (pulseTimer) {
    clearInterval(pulseTimer);
    pulseTimer = null;
  }
  if (tray) tray.setImage(baseImage);
}

function createTray(ctrl) {
  controller = ctrl;
  baseImage = trayImage();
  tray = new Tray(baseImage);
  tray.setToolTip('WQXR Streamer');

  // Left-click toggles the popover; right-click shows the menu. We intentionally
  // do NOT use setContextMenu on macOS/Windows, because that makes a *left*-click
  // pop the menu too (the bug where both the popover and menu appeared). Linux
  // app-indicators don't fire reliable click events, so there we fall back to
  // setContextMenu (handled in update()).
  tray.on('click', () => {
    if (process.platform === 'linux') return;
    controller.togglePopover(tray.getBounds());
  });
  tray.on('right-click', () => {
    if (process.platform === 'linux') return;
    if (contextMenu) tray.popUpContextMenu(contextMenu);
  });

  update();
  return tray;
}

function buildMenu() {
  const playing = controller.isPlaying;
  const streamItems = STREAMS.map((s) => ({
    label: s.name,
    type: 'radio',
    checked: s.id === controller.streamId,
    click: () => controller.setStream(s.id),
  }));

  return Menu.buildFromTemplate([
    {
      label: playing ? 'Pause' : 'Play',
      click: () => controller.togglePlay(),
    },
    { type: 'separator' },
    { label: 'Stream', enabled: false },
    ...streamItems,
    { type: 'separator' },
    { label: 'Open Window', click: () => controller.openMainWindow() },
    {
      label: 'Play on launch',
      type: 'checkbox',
      checked: controller.autoplay,
      click: (item) => controller.setAutoplay(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit WQXR Streamer', click: () => controller.quit() },
  ]);
}

// Rebuild the menu and refresh the tooltip whenever app state changes.
function update() {
  if (!tray) return;
  contextMenu = buildMenu();
  // Linux: attach the menu so the indicator has an affordance. macOS/Windows:
  // we pop it up manually on right-click (see createTray) to keep left-click
  // dedicated to the popover.
  if (process.platform === 'linux') tray.setContextMenu(contextMenu);

  // Breathe the icon while playing; rest when stopped.
  if (controller.isPlaying) startPulse();
  else stopPulse();

  const label = controller.currentTrackLabel();
  tray.setToolTip(label ? `WQXR Streamer — ${label}` : 'WQXR Streamer');
}

function getBounds() {
  return tray ? tray.getBounds() : null;
}

function destroy() {
  stopPulse();
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, update, destroy, getBounds };
