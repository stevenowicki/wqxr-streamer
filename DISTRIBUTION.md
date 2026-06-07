# Packaging & Distribution

Builds are produced by [electron-builder](https://www.electron.build/) using
`electron-builder.config.cjs`. Output lands in `dist/`.

| Command | What it does |
|---|---|
| `npm run pack` | **Unsigned** Apple Silicon build — quick local test, no cert needed. |
| `npm run dist:mac` | **Apple Silicon** `.dmg` (arm64, ~94 MB). Signs/notarizes if creds are set (below). |
| `npm run dist:mac:intel` | **Intel** `.dmg` (x64) — only if you need to support pre-2020 Macs. |
| `npm run dist:win` | **Windows** NSIS installer. Unsigned locally; signed in CI — see [Windows](#windows-signed-installer-via-azure-trusted-signing--github-actions). |

> Per-arch DMGs, not a universal binary — modern users don't download Intel code
> they'll never run. Apple Silicon is the default; Intel is opt-in.
>
> **macOS DMGs are built locally; the Windows `.exe` is built + signed in CI**
> (`.github/workflows/windows-release.yml`). Linux is the only target intentionally
> left out — a few lines in `electron-builder.config.cjs` if ever wanted.

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

## Windows: signed installer via Azure Trusted Signing + GitHub Actions

Windows is wired up. `electron-builder.config.cjs` has the `win` (NSIS) target,
`npm run dist:win` builds it, and **`.github/workflows/windows-release.yml`** builds +
signs + attaches it to a release **on a GitHub-hosted Windows runner — you never need a
PC.** Signing uses **Azure Trusted Signing** (cloud HSM, ~$10/mo); public-repo Actions
minutes are free. (`build/icon.ico` is already generated.)

### One-time Azure setup (in the [Azure portal](https://portal.azure.com))

1. **Trusted Signing account** — create one (search "Trusted Signing" / "Artifact
   Signing" → Create). Note the **region** (it sets your endpoint: East US →
   `https://eus.codesigning.azure.net/`, West Europe → `https://weu…`) and the
   **account name**.
2. **Identity validation** — on the account, give your user the **Trusted Signing
   Identity Verifier** role (Access control (IAM)). Then account → **Identity
   validations** → New → **Individual → Public**, complete the ID check (fast for
   individuals, ~10–20 min). Wait for **Completed**.
3. **Certificate profile** — account → Objects → **Certificate profiles** → Create →
   **Public Trust** → pick your completed validation. Note the **profile name**; the
   cert CN is your validated name (the publisher Windows users will see).
4. **App registration (CI identity)** — Entra ID → App registrations → New (e.g.
   `wqxr-streamer-ci`). Note **Application (client) ID** + **Directory (tenant) ID**;
   Certificates & secrets → New client secret → copy the **Value**.
5. **Grant the signer role** — back on the Trusted Signing **account** → Access control
   (IAM) → Add role assignment → **Artifact Signing Certificate Profile Signer**
   (the role was renamed from "Trusted Signing…") → assign to the **app
   registration** (NOT your user; scope = the account).

### Repo secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
|---|---|
| `AZURE_TENANT_ID` | Directory (tenant) id |
| `AZURE_CLIENT_ID` | App registration application id |
| `AZURE_CLIENT_SECRET` | the client secret **value** |
| `AZURE_ENDPOINT` | e.g. `https://eus.codesigning.azure.net/` |
| `AZURE_CODE_SIGNING_NAME` | Trusted Signing account name |
| `AZURE_CERT_PROFILE_NAME` | certificate profile name |

> **Three gotchas already baked into the config** (the build is green; noted in
> case the tooling regresses):
> 1. **No `publisherName`** in `azureSignOptions` — the current TrustedSigning module
>    dropped it; electron-builder 25.x errors if it's passed. Publisher comes from the
>    cert subject. (So there's deliberately no `AZURE_PUBLISHER_NAME` secret.)
> 2. **Space-free exe/installer names** (`win.executableName`, `nsis.artifactName`) —
>    the signing module splits the file path on spaces, so "WQXR Streamer.exe" fails.
> 3. **`--publish never`** on `dist:win` — electron-builder auto-publishes in CI and
>    dies on a missing `GH_TOKEN`; the workflow's own upload step ships the asset.

### Cut the Windows build

Publishing a release triggers it automatically. To run it for an existing release (or
any time): **Actions → "Windows installer" → Run workflow → enter the tag** (e.g.
`v1.0.0`). It builds, signs, **verifies the Authenticode signature** (the job fails if
the installer isn't Valid-signed — so a bad secret/role can never ship an unsigned
exe), and uploads **`WQXR-Streamer-Setup.exe`** to that release. To add a Windows button
to the site, link `…/releases/latest/download/WQXR-Streamer-Setup.exe`.

> SmartScreen note: signing removes "unknown publisher" immediately; the reputation
> prompt fades as downloads accumulate under your stable signing identity.

### Platform behavior to sanity-check (hasn't run on Windows yet)
- **Tray icon** uses colored `assets/tray.png` (template image is macOS-only).
- **The "breathing" pulse is macOS-only** (`startPulse()` bails on non-darwin).
- **Popover positioning** — Windows' tray is bottom-right; `positionPopoverNear()`'s
  non-darwin branch anchors above it — verify across taskbar positions / monitors.
- **Click-away / focus** — the `app.focus({ steal: true })` trick is darwin-only.
- **Media keys / SMTC** — `navigator.mediaSession` → Windows System Media Transport
  Controls; confirm play/pause + metadata in the volume flyout.

## Notes

- App icon (`build/`) is the fan-made lockup; menu-bar/tray art (`assets/`) is the
  WQXR wordmark. Regenerated by a throwaway Pillow script from the station's square
  logo — see CLAUDE.md → "Branding & assets."
- Version comes from `package.json` `version`. Bump it for each release.
- The app is not sandboxed (it's a plain network client); the only entitlements
  are the hardened-runtime ones in `build/entitlements.mac.plist` that Electron
  requires for notarization.
