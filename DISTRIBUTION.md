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

Your keychain currently only has **Apple Development** certs, which can't sign for
distribution. You need a **Developer ID Application** cert (requires the paid
Apple Developer Program, as Account Holder or Admin).

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
APPLE_ID=steve@stevenowicki.com
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

## Notes

- App icon / tray art are in `build/` and `assets/`, derived from WQXR's logo.
- Version comes from `package.json` `version`. Bump it for each release.
- The app is not sandboxed (it's a plain network client); the only entitlements
  are the hardened-runtime ones in `build/entitlements.mac.plist` that Electron
  requires for notarization.
