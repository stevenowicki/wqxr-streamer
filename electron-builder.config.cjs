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

  // Windows: NSIS installer. Built in CI (windows-latest) via `npm run dist:win`.
  // Code signing is wired to Azure Trusted Signing — see the conditional below.
  win: {
    target: ['nsis'],
    icon: 'build/icon.ico',
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

// Sign the Windows build with Azure Trusted Signing when its config is present
// (set in CI from GitHub secrets). Auth comes from the standard Azure.Identity
// env vars AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET. Without these,
// `npm run dist:win` produces an unsigned installer (fine for local testing).
if (
  process.env.AZURE_ENDPOINT &&
  process.env.AZURE_CODE_SIGNING_NAME &&
  process.env.AZURE_CERT_PROFILE_NAME
) {
  // NB: do NOT pass `publisherName` — the current TrustedSigning PowerShell
  // module dropped that parameter (publisher comes from the cert subject), and
  // electron-builder 25.x errors with "A parameter cannot be found that matches
  // parameter name 'publisherName'" if it's set. The cert CN is authoritative.
  config.win.azureSignOptions = {
    endpoint: process.env.AZURE_ENDPOINT, // e.g. https://eus.codesigning.azure.net/
    codeSigningAccountName: process.env.AZURE_CODE_SIGNING_NAME,
    certificateProfileName: process.env.AZURE_CERT_PROFILE_NAME,
  };
}

module.exports = config;
