# Packaging & Distribution

Builds are produced by [electron-builder](https://www.electron.build/) using
`electron-builder.config.cjs`. Output lands in `dist/`.

| Command | What it does |
|---|---|
| `npm run pack` | **Unsigned** Apple Silicon build — quick local test, no cert needed. |
| `npm run dist:mac` | **Apple Silicon** `.dmg` (arm64, ~94 MB). Signs/notarizes if creds are set (below). |
| `npm run dist:mac:intel` | **Intel** `.dmg` (x64) — only if you need to support pre-2020 Macs. |

> Per-arch DMGs, not a universal binary — modern users don't download Intel code
> they'll never run. Apple Silicon is the default; Intel is opt-in.
>
> Mac-only for now. Windows/Linux targets were intentionally left out; they're a
> few lines to add back in `electron-builder.config.cjs` later.

> **DMG stapling:** electron-builder notarizes and staples the `.app`, but not the
> `.dmg` container. After `dist:mac`, also staple the dmg so the disk image itself
> is friction-free:
> ```bash
> set -a; . ./.env; set +a
> xcrun notarytool submit "dist/WQXR Streamer-1.0.0-arm64.dmg" \
>   --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
> xcrun stapler staple "dist/WQXR Streamer-1.0.0-arm64.dmg"
> ```

---

## macOS: signed + notarized DMG

Without this, downloaders get "WQXR Streamer is damaged / can't be opened."
Signed + notarized, it opens with no warning.

### 1. Create a "Developer ID Application" certificate (one time)

Distribution needs a **Developer ID Application** certificate (requires the paid
Apple Developer Program, as Account Holder or Admin). Plain **Apple Development**
certs can't sign apps for distribution outside the App Store. If your paid account
belongs to an organization, switch Xcode to that team before creating the cert —
the cert's team id is what goes in `APPLE_TEAM_ID`.

Easiest path — in **Xcode**:
1. Xcode → **Settings… → Accounts**.
2. Select your team → **Manage Certificates…**
3. Click **+** → **Developer ID Application**. It's created and installed into your login keychain.

Verify it's there:
```bash
security find-identity -v -p codesigning | grep "Developer ID Application"
```
You should see `Developer ID Application: Steve Nowicki (TEAMID)`. That `TEAMID`
(10 chars) is your Apple Team ID.

### 2. Get notarization credentials (one time)

Pick **one** option.

**Option A — App Store Connect API key (recommended, most robust):**
1. https://appstoreconnect.apple.com → **Users and Access → Integrations → App Store Connect API**.
2. Generate an **API Key** (Developer access is enough). Download the `AuthKey_XXXX.p8` (you can only download it once — keep it safe, e.g. `~/.appstoreconnect/AuthKey_XXXX.p8`).
3. Note the **Key ID** and the **Issuer ID** shown on that page.

**Option B — Apple ID + app-specific password:**
1. https://account.apple.com → **Sign-In and Security → App-Specific Passwords** → generate one (e.g. labeled "wqxr-notarize").
2. You'll use your Apple ID email + that password + your Team ID.

### 3. Put the credentials in `.env`

Copy `.env.example` to `.env` and fill in your values (no `export`, no quotes
needed; a leading `~/` is expanded). The build loads `.env` automatically, and
`.env` / `*.p8` are git-ignored so nothing secret lands in the repo or your
shell history.

```bash
cp .env.example .env
# then edit .env
```

`.env` with an API key (Option A):
```
APPLE_TEAM_ID=YOURTEAMID
APPLE_API_KEY=~/.appstoreconnect/AuthKey_XXXX.p8
APPLE_API_KEY_ID=XXXX
APPLE_API_ISSUER=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
```

…or with an Apple ID (Option B):
```
APPLE_TEAM_ID=YOURTEAMID
APPLE_ID=you@example.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

### 4. Build

```bash
npm run dist:mac
```

electron-builder signs with your Developer ID cert, uploads to Apple for
notarization (a few minutes), and staples the ticket to the app. Notarization
turns on automatically only when the credentials above are present. Result:
`dist/WQXR Streamer-1.0.0-arm64.dmg` (then staple the dmg too — see the box above).

### 5. Verify the result

```bash
# App is notarized + accepted by Gatekeeper (run on the .app, e.g. in dist/mac-arm64):
spctl -a -vvv -t exec "dist/mac-arm64/WQXR Streamer.app"
# Notarization ticket is stapled to the dmg:
xcrun stapler validate "dist/WQXR Streamer-1.0.0-arm64.dmg"
```

> Note: `spctl -t install` reports "no usable signature" for a `.dmg` — that's
> expected (it tests for *installer-package* signatures, which a disk image
> doesn't have). Use `stapler validate` to confirm the dmg's notarization.

---

## Cutting a release (the actual distribution)

Downloads are hosted on **GitHub Releases**, not the website's bucket. The website
([content.stevenowicki.com/wqxr/](https://content.stevenowicki.com/wqxr/)) links to
`…/releases/latest/download/WQXR-Streamer-AppleSilicon.dmg` (and `-Intel.dmg`), so
the asset names must stay **stable** (no version in the filename) for those links to
keep working.

1. Build + notarize + staple **both** arch DMGs (`npm run dist:mac` and
   `npm run dist:mac:intel`, then staple each — see the box at the top).
2. Copy them to the stable release names:
   ```bash
   cp "dist/WQXR Streamer-<ver>-arm64.dmg" dist/WQXR-Streamer-AppleSilicon.dmg
   cp "dist/WQXR Streamer-<ver>.dmg"       dist/WQXR-Streamer-Intel.dmg
   ```
3. Create the release:
   ```bash
   gh release create vX.Y.Z --repo stevenowicki/wqxr-streamer \
     --title "WQXR Streamer X.Y.Z" --notes-file notes.md \
     dist/WQXR-Streamer-AppleSilicon.dmg dist/WQXR-Streamer-Intel.dmg
   ```
4. If `package.json` `version` changed, the in-page "v1.0.0" labels are cosmetic —
   update them in `public/index.html` if you like.
5. Ship any website changes: `npm run deploy:site` (see [CLAUDE.md](CLAUDE.md)).

## Building for Windows (not currently built — here's what it would take)

The app is plain Electron and already guards platform-specific code with
`process.platform`, so a Windows build is achievable — it's just never been built or
tested. If you want to tackle it:

**1. Re-add the Windows target** to `electron-builder.config.cjs`:
```js
config.win = {
  target: ['nsis'],        // NSIS installer; or 'portable' / 'zip'
  icon: 'build/icon.ico',  // already generated, multi-size
};
```
and a script in `package.json`:
```json
"dist:win": "electron-builder --win --config electron-builder.config.cjs"
```

**2. Build on Windows.** The reliable path is a Windows machine or a
`windows-latest` GitHub Actions runner. electron-builder *can* cross-build Windows
from macOS via Wine (`brew install --cask wine-stable`), but it's flaky — don't rely
on it for a real release.

**3. Code signing is separate from Apple.** Windows uses its own code-signing
certificate — an OV or EV cert from a CA (DigiCert, Sectigo, …), a paid yearly thing.
The Apple Developer ID does nothing here, and there is **no notarization** on Windows.
- Unsigned is fine for a small audience: SmartScreen shows a one-time "unknown
  publisher → More info → Run anyway" prompt.
- To sign, set `CSC_LINK` (path to your `.pfx`/`.p12`) and `CSC_KEY_PASSWORD`;
  electron-builder signs automatically. EV certs usually need a hardware token / cloud
  HSM, which complicates CI.

**4. Verify the platform-specific behavior** (none of this has run on Windows):
- **Tray icon** uses the colored `assets/tray.png` (the template image is macOS-only).
  Check it reads well in the system tray.
- **The "breathing" pulse is macOS-only** — `startPulse()` in `tray.js` bails on
  non-darwin. A contributor could add a colored animated tray for Windows.
- **Popover positioning** — Windows' tray is bottom-right (taskbar), not the top menu
  bar. `positionPopoverNear()` has a non-darwin branch that anchors above the tray;
  confirm it lands correctly across taskbar positions and multiple monitors.
- **Click-away & focus** — the `app.focus({ steal: true })` show trick is darwin-only;
  Windows windows foreground normally on show, but verify blur-to-hide and
  tray-click-to-toggle still feel right.
- **Media keys / SMTC** — `navigator.mediaSession` maps to the Windows System Media
  Transport Controls; confirm play/pause and metadata appear in the volume flyout.

The cleanest shipping path is a `windows-latest` GitHub Actions job that runs
`npm ci && npm run dist:win` and attaches the `.exe` to the release.

## Notes

- App icon (`build/`) is the fan-made lockup; menu-bar/tray art (`assets/`) is the
  WQXR wordmark. Regenerated by a throwaway Pillow script from the station's square
  logo — see CLAUDE.md → "Branding & assets."
- Version comes from `package.json` `version`. Bump it for each release.
- The app is not sandboxed (it's a plain network client); the only entitlements
  are the hardened-runtime ones in `build/entitlements.mac.plist` that Electron
  requires for notarization.
