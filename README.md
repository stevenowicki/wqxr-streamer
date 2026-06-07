# WQXR Streamer

A clean, native **macOS & Windows** menu-bar / system-tray player for
[WQXR](https://www.wqxr.org/) — New York's classical music station. Play and pause are always
one click away, next to your clock, showing the current show and host, the composer and piece,
and what just played — and never a stray browser window.

**▶ [Download](https://content.stevenowicki.com/wqxr/)** for macOS (Apple Silicon or Intel) or
Windows — free, signed & notarized. Or grab a build straight from
[Releases](https://github.com/stevenowicki/wqxr-streamer/releases/latest).

It does only what wqxr.org already does — stream the audio and show the now-playing info —
just packaged as a proper desktop app, using WQXR's own public endpoints.

> **Unofficial fan project.** Not affiliated with, sponsored by, or endorsed by WQXR or New
> York Public Radio. "WQXR" and its logo are trademarks of New York Public Radio; this app
> uses the station's name and mark only to identify the station it plays, and clearly labels
> itself "a fan-made app." Please support WQXR at [wqxr.org](https://www.wqxr.org/).

## Features

- **Tray-first.** A menu-bar icon (macOS) / system-tray icon (Windows) with the WQXR
  wordmark. Left-click opens a compact popover (click away to dismiss); right-click gives
  Play/Pause, the stream switcher, the full window, and Quit. You can never "lose" it
  behind other windows. The popover appears once on launch so you know it's running.
- **The menu-bar icon gently breathes while audio is playing** (macOS) — a quiet cue for
  where the music is coming from.
- **Now playing.** Host/show photo, show name, current composer & piece, and performers.
- **Recently played.** A rolling list, pre-seeded from today's playlist on launch.
- **Three streams.** WQXR 105.9, New Sounds, and Operavore — switchable.
- **Manual by default**, with an opt-in **Play on launch** toggle in the tray menu.
- **OS media integration.** Hardware media keys plus macOS Control Center "Now Playing",
  Windows SMTC, and Linux MPRIS, with correct title/composer/artwork.
- **Links open in your real browser**, never inside the app.
- **Remembers** your stream and volume between launches.

## Develop

```bash
npm install
npm run restart   # kill any running instance, then start  (use this, not `npm start`)
```

The app starts in the tray with no dock icon. Click the tray icon to open the player.
Set `WQXR_DEBUG=1` to forward renderer console logs to the terminal.

> Use `npm run restart` rather than `npm start`: the app persists in the tray, so a
> plain `npm start` can defer to an already-running (stale) instance.

**New here?** Read **[CLAUDE.md](CLAUDE.md)** — it covers the architecture (single
hidden audio engine, view/main split), the load-bearing gotchas, and how to build,
release, and deploy the site.

## Build & release

**macOS** — built locally:

```bash
npm run pack            # unsigned local test build (Apple Silicon)
npm run dist:mac        # Apple Silicon .dmg  (signs + notarizes if creds are set)
npm run dist:mac:intel  # Intel .dmg
```

**Windows** — built + signed in CI, **no PC needed**: the
[`windows-release.yml`](.github/workflows/windows-release.yml) GitHub Actions workflow builds
the NSIS installer on a `windows-latest` runner and signs it with **Azure Trusted Signing**. It
runs automatically when a release is published, or on demand. (`npm run dist:win` builds it
locally — unsigned unless the Azure env vars are set.)

Both signed builds ship on **GitHub Releases** under stable names
(`WQXR-Streamer-AppleSilicon.dmg`, `-Intel.dmg`, `WQXR-Streamer-Setup.exe`), and the download
site links to `…/releases/latest/download/…`. The full walkthrough — Developer ID cert + Apple
notarization, Azure Trusted Signing setup, and cutting a release — is in
**[DISTRIBUTION.md](DISTRIBUTION.md)**. Credentials live in a git-ignored `.env`.

`npm run deploy:site` packages `public/` and ships the download site to
content.stevenowicki.com/wqxr/.

## How it works

| Concern | Source |
|---|---|
| Audio | `https://stream.wqxr.org/wqxr` (MP3) and the q2 / operavore equivalents |
| Now playing | `https://api.wnyc.org/api/v1/whats_on/{slug}/` |
| Recently played | `https://api.wnyc.org/api/v1/playlist-daily/{slug}/Y/mon/D/` |

All network fetches happen in the main process (`src/main/nowplaying.js`) and are pushed to
renderers over a locked-down `contextBridge` (`src/preload/preload.js`).

Audio lives in a single **hidden engine window** (`src/renderer/engine.js`) — the only
`<audio>` element and OS media session in the app — so there's never a risk of two windows
playing at once. The visible popover and main window (`src/renderer/player.js`, `ui.js`) are
pure views: they render now-playing state and forward user intents (play, switch stream,
volume) to the main process, which routes them to the engine. The main process owns the
tray, windows, now-playing polling, and is the single coordinator of state.

The app icon (`build/`) is a fan-made lockup — the station's wordmark over "STREAMER" and
"(fan-made with love)" — and the menu-bar icon (`assets/`) is the wordmark alone. See the
unofficial-project note at the top.

## License

[MIT](LICENSE) © Steve Nowicki. WQXR's name, marks, and broadcast content remain the property
of New York Public Radio; this project's MIT license covers only its own original code.
