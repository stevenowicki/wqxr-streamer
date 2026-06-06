'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Tiny hand-rolled preferences store — no dependency needed for three values.
// Persists to prefs.json under the per-user Electron userData directory.

const DEFAULTS = {
  streamId: 'wqxr',
  volume: 0.85,
  muted: false,
  autoplay: false, // opt-in: start the last stream on launch
};

let cache = null;
let filePath = null;

function file() {
  if (!filePath) {
    filePath = path.join(app.getPath('userData'), 'prefs.json');
  }
  return filePath;
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(file(), 'utf8');
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function get(key) {
  return load()[key];
}

function set(patch) {
  cache = { ...load(), ...patch };
  try {
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('[store] failed to persist prefs:', err.message);
  }
  return cache;
}

module.exports = { load, get, set, DEFAULTS };
