'use strict';

// electron-builder configuration. Kept as a .cjs file (rather than the
// package.json "build" block) so it can load credentials from a local .env and
// enable notarization conditionally — the build works unsigned, signed, or
// signed+notarized depending on what's present, with no edits.

// --- load .env (KEY=VALUE per line) without adding a dependency -------------
(() => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/);
    if (!m) continue; // skips blanks and # comments
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val.startsWith('~/')) val = path.join(os.homedir(), val.slice(2));
    if (!(key in process.env)) process.env[key] = val; // real env vars win
  }
})();

const config = {
  appId: 'org.snowicki.wqxr-streamer',
  productName: 'WQXR Streamer',
  directories: {
    output: 'dist',
    buildResources: 'build',
  },
  files: ['src/**/*', 'assets/**/*'],

  mac: {
    category: 'public.app-category.music',
    // DMG target with NO arch here on purpose — the arch comes from the CLI
    // flag in each npm script (`dist:mac` -> --arm64, `dist:mac:intel` -> --x64).
    // (Listing arch here would override the flag and build every arch at once.)
    target: ['dmg'],
    icon: 'build/icon.icns',
    // Required for notarization.
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
  },
};

// Enable notarization only when credentials are available. Provide either:
//   APPLE_TEAM_ID + APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD          (Apple ID), or
//   APPLE_TEAM_ID + APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER  (API key)
const hasNotarizeCreds =
  process.env.APPLE_TEAM_ID &&
  ((process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD) ||
    (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER));

if (hasNotarizeCreds) {
  // Team id is taken from APPLE_TEAM_ID in the environment (electron-builder
  // prefers that over notarize.teamId, which it warns about).
  config.mac.notarize = true;
}

module.exports = config;
