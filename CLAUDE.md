# CLAUDE.md — working in this repo

Guidance for an engineer (or Claude) resuming work on **WQXR Streamer**. Read this
first; it captures the architecture and the non-obvious traps that cost real time
to discover.

## What this is

A small, native **macOS menu-bar player** for [WQXR](https://www.wqxr.org/), New
York's classical radio station. Plain Electron + vanilla JS, **zero runtime
dependencies**. It streams the station and mirrors the station's own now-playing /
recently-played info. That's the whole scope.

> **Unofficial fan project.** Not affiliated with or endorsed by WQXR / New York
> Public Radio. **Scope rule:** do only what wqxr.org already does (stream + show
> now-playing). Don't add features the website doesn't have (favorites, recording,
> scheduling, accounts, alarms) without the maintainer's say-so. The app celebrates
> the station; it doesn't compete with it.

## Quick start

```bash
npm install
npm start                 # launches into the menu bar (no dock icon)
WQXR_DEBUG=1 npm start     # forward renderer console + tray logs to the terminal
npm run restart           # kill any running instance, then start  ← use this in dev
```

> ⚠️ **The stale-instance trap.** The app is designed to persist in the tray —
> closing its window only hides it. So a plain `npm start` hits the single-instance
> lock and **defers to the already-running (possibly stale) instance**, and you end
> up testing old code. Always `npm run restart`, or check first:
> `pgrep -f 'wqxr-streamer/node_modules/electron'`.

> ⚠️ **Electron binary may install incomplete.** On some Macs `npm install` leaves
> `node_modules/electron/dist/` missing its `Frameworks/` (launch fails with
> "Electron failed to install correctly"). The downloaded zip in
> `~/Library/Caches/electron/<hash>/` is usually fine — unzip it into `dist/` and
> write `path.txt` (`Electron.app/Contents/MacOS/Electron`). Tell-tale: a ~49K
> `MacOS/Electron` is normal; a missing `Frameworks/` is the real problem.

## Architecture

Three processes, one rule: **exactly one `<audio>` element exists, ever.**

- **Main** (`src/main/`) — owns the tray, windows, now-playing polling, and is the
  single coordinator of state. `main.js` holds the `controller` object (the state +
  routing hub).
- **Engine** (`src/renderer/engine.js`, hidden window) — the **only** `<audio>` and
  the only `navigator.mediaSession`. Takes commands from main, reports authoritative
  playback state back. This is why two windows can never double-play.
- **Views** (`src/renderer/player.js` + `ui.js`) — the popover and the optional main
  window. Pure UI: render state pushed from main, forward user intents. They own no
  audio.
- **Preload** (`src/preload/preload.js`) — one locked-down `contextBridge`; no Node
  in renderers.

State flow: user clicks play in a **view** → `ui:toggle` → main `controller` →
`engine:command` → **engine** plays → `engine:playback` → main → `state` broadcast →
all views + tray update. Stream/volume follow the same path.

### File map

| File | Role |
|---|---|
| `src/main/main.js` | app lifecycle; the `controller` (state + routing); launch popover |
| `src/main/windows.js` | engine/popover/main-window creation; popover show/hide + positioning |
| `src/main/tray.js` | menu-bar icon, context menu, tooltip, the "breathing" pulse |
| `src/main/nowplaying.js` | polls WNYC APIs; **no Electron deps → unit-testable with plain node** |
| `src/main/streams.js` | the 3 stream definitions (id, name, slug, mp3 url) |
| `src/main/store.js` | tiny JSON prefs (`streamId`, `volume`, `muted`, `autoplay`) |
| `src/main/ipc.js` | IPC handlers; allow-listed external link opening |
| `src/renderer/engine.js` | the audio engine (see gotchas) |
| `src/renderer/player.js`, `ui.js`, `index.html`, `app.css` | the view |
| `electron-builder.config.cjs` | packaging; loads `.env`; per-arch dmg |

## Gotchas (these are load-bearing — don't "simplify" them away)

**Audio (`engine.js`):**
- **Do NOT reconnect on `stalled`/`waiting`.** Those fire during normal first-connect
  buffering; reconnecting tears down the in-flight `play()` → "interrupted by a new
  load request" → a reconnect storm. Only `error`/`ended` trigger a reconnect.
- **`loadAndPlay` must call `audio.load()`** after setting `src`, or a cold first
  connect intermittently stalls forever. (`load()` was wrongly blamed before; the
  real culprit was the storm above.)
- A **~4s watchdog** retries a connect that never reaches `playing`. `AbortError`
  from `play()` is ignored.
- `streamId` is owned by `setStream`/init **only** — never let now-playing metadata
  set it, or it races the `engine:setStream` "did it change?" guard and skips play.

**Tray + popover (`tray.js`, `windows.js`):**
- **Don't `tray.setContextMenu()` on macOS/Windows** — it makes a *left*-click open
  the menu too. Use `popUpContextMenu()` from the `right-click` handler. Linux is the
  exception (no reliable click events → it does use `setContextMenu`).
- **No `alwaysOnTop` on the popover** — an always-on-top window doesn't reliably lose
  focus, so the `blur`-to-hide (click-away) never fires.
- The popover must be the **key** window for `blur` to fire. With the dock hidden,
  showing it doesn't activate the app, so `showPopover` calls
  `app.focus({ steal: true })` (darwin). A short post-show grace + a `lastHiddenAt`
  guard handle the launch transient and the tray-click-to-close race.
- **Launch positioning:** `tray.getBounds()` returns bogus values (height 0, wrong
  display) until the menu-bar item lays out. `presentOnLaunch` polls for *stable*
  bounds (height ≥ 16, two equal reads) before positioning, or the popover lands in a
  screen corner / wrong monitor.

**Now-playing (`nowplaying.js`):**
- "Recently played" **excludes the current track** (it's shown separately).
- History is seeded from WQXR's own `playlist-daily` feed on launch, then appended
  live — so it's their data, not ours.

## Data sources

| What | URL |
|---|---|
| Audio | `https://stream.wqxr.org/wqxr` (+ q2 / operavore equivalents) — see `streams.js` |
| Now playing | `https://api.wnyc.org/api/v1/whats_on/{slug}/` |
| Recently played | `https://api.wnyc.org/api/v1/playlist-daily/{slug}/Y/mon/D/` |

## Testing the data layer headlessly

`nowplaying.js` has no Electron imports, so you can exercise it with plain node:

```js
const np = require('./src/main/nowplaying.js');
np.on('update', s => console.log(s.track, s.history.length));
np.setStream('wqxr');
```

## Build & distribution

macOS only today (Electron, so largely cross-platform; only the Mac target is
produced). Per-arch DMGs, signed + notarized. Full walkthrough — Developer ID cert,
`.env` credentials, dmg stapling, **cutting a GitHub release** — is in
**[DISTRIBUTION.md](DISTRIBUTION.md)**.

```bash
npm run pack             # unsigned local test (arm64)
npm run dist:mac         # Apple Silicon signed+notarized .dmg
npm run dist:mac:intel   # Intel .dmg
```

Credentials live in a git-ignored `.env` (template: `.env.example`); the build
auto-loads it and only notarizes when creds are present.

**Windows** builds + signs in CI: `.github/workflows/windows-release.yml` runs on a
GitHub-hosted `windows-latest` runner, builds the NSIS installer (`npm run dist:win`),
signs it with **Azure Trusted Signing** (`win.azureSignOptions`, fed from `AZURE_*`
repo secrets), verifies the Authenticode signature, and attaches
`WQXR-Streamer-Setup.exe` to the release — no PC needed. One-time Azure setup, the
secret list, and the platform behavior still to test on Windows are in
DISTRIBUTION.md → "Windows".

**Downloads are hosted on GitHub Releases** (repo `stevenowicki/wqxr-streamer`),
under stable names (`WQXR-Streamer-AppleSilicon.dmg`, `-Intel.dmg`) so the website's
`/releases/latest/download/...` links never break.

## Website & deploy

The download/landing site + full user docs live in **`public/`** (`index.html`,
`styles.css`, icons, `og.png`). It's served at
**content.stevenowicki.com/wqxr/**.

```bash
npm run deploy:site      # = scripts/deploy-site.sh
```

That stages a tarball + declarative manifest into a watched `go-live` folder
(`~/Projects/content.stevenowicki.com/go-live`); a privileged watcher uploads to S3
and invalidates CloudFront. We never touch AWS. `target_prefix` is `wqxr`; deploys
are additive. To preview locally there's a `wqxr-site` config in `.claude/launch.json`
(a `python3 -m http.server` over `public/`).

## Branding & assets

The mark is a **fan-made lockup** on WQXR's blue: the station **WQXR :|** wordmark /
**STREAMER** (Proxima Nova) / *(fan-made with love)* (Georgia italic). The app icon
(`build/icon.*`) is the full lockup; the menu-bar/tray + pulse frames (`assets/`) are
the wordmark alone. The `og.png` share card is dark slate + gold.

These PNGs are committed (they're the source of truth). They were generated by a
throwaway Pillow script from the station's square logo
(`https://media.wnyc.org/i/1024/1024/c/80/1/wqxr_square_logo.png`); regenerate by
re-running an equivalent script if the brand changes. Trademark posture: the station
name and `:|` mark are used to identify the station, always with the visible
"fan-made / unofficial" labeling (icon, site footer, README, LICENSE).

## Conventions

- Vanilla JS, no framework, no runtime deps — keep it that way unless there's a
  strong reason.
- `npm run restart` in dev (not `npm start`).
- Commit only when asked; never commit `.env` or `*.p8`.
- Keep the unofficial-fan framing intact in any user-facing copy.
