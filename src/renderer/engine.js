'use strict';

// The audio engine. Runs in a single hidden window so there's exactly one
// <audio> element and one OS media session for the whole app, no matter how
// many view windows are open. It takes commands from the main process and
// reports authoritative playback state back.
(function () {
  const audio = document.getElementById('audio');

  const state = {
    streams: [],
    streamId: null,
    volume: 0.85,
    muted: false,
    intendToPlay: false, // the user's intent (vs. audio.paused, which lags)
    playing: false, // true once the 'playing' event has fired
    reconnectAttempts: 0,
    reconnectTimer: null,
    watchdog: null, // fires if a (re)connect never reaches 'playing'
    lastNowPlaying: null,
  };

  function currentStream() {
    return state.streams.find((s) => s.id === state.streamId) || state.streams[0];
  }

  // ---- playback -----------------------------------------------------------

  function play() {
    const stream = currentStream();
    if (!stream) return;
    state.intendToPlay = true;
    loadAndPlay(stream.mp3);
    reportPlayback();
    updateMediaSession();
  }

  // (Re)connect to the live edge. Assigning `src` re-runs the media load
  // algorithm on its own, so we deliberately do NOT also call audio.load() —
  // that second load is what raced the play() promise ("interrupted by a new
  // load request"). A load watchdog recovers from a connection that never
  // reaches 'playing' (a cold first connect can stall).
  function loadAndPlay(url) {
    state.playing = false;
    audio.src = url;
    audio.load(); // needed to reliably kick off the fetch on a cold first connect
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        // AbortError just means a newer load superseded this one — the watchdog
        // (or that newer load) covers it. Anything else is a real failure.
        if (err && err.name === 'AbortError') return;
        if (state.intendToPlay) scheduleReconnect();
      });
    }
    armWatchdog();
  }

  function stop() {
    state.intendToPlay = false;
    state.playing = false;
    clearTimers();
    audio.pause();
    audio.removeAttribute('src');
    audio.load(); // drop the network connection entirely
    reportPlayback();
    updateMediaSession();
  }

  function toggle() {
    if (state.intendToPlay) stop();
    else play();
  }

  function setStream(id) {
    if (!state.streams.some((s) => s.id === id)) return;
    if (id === state.streamId) return;
    const wasPlaying = state.intendToPlay;
    state.streamId = id;
    state.reconnectAttempts = 0;
    clearTimers();
    if (wasPlaying) {
      play(); // reconnect to the newly selected stream
    } else {
      audio.removeAttribute('src');
    }
  }

  // ---- reconnect with backoff --------------------------------------------

  function clearTimers() {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.watchdog) {
      clearTimeout(state.watchdog);
      state.watchdog = null;
    }
  }

  // If a (re)connect hasn't reached 'playing' within a few seconds it's stuck —
  // retry. One retry per window (not one per 'stalled' event), so no storm.
  function armWatchdog() {
    if (state.watchdog) clearTimeout(state.watchdog);
    state.watchdog = setTimeout(() => {
      state.watchdog = null;
      if (state.intendToPlay && !state.playing) scheduleReconnect();
    }, 4000);
  }

  function scheduleReconnect() {
    clearTimers();
    if (!state.intendToPlay) return;
    const delay = Math.min(30000, 1000 * Math.pow(2, state.reconnectAttempts));
    state.reconnectAttempts += 1;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      if (state.intendToPlay) loadAndPlay(currentStream().mp3);
    }, delay);
  }

  // ---- audio element events ----------------------------------------------

  audio.addEventListener('playing', () => {
    state.playing = true;
    state.reconnectAttempts = 0;
    clearTimers();
    reportPlayback();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  });
  // Do NOT reconnect on 'stalled'/'waiting' — they fire normally while a live
  // stream is still buffering on first connect, and reconnecting then would
  // abort the in-flight play() (a storm). The watchdog handles a connect that
  // truly never starts.
  audio.addEventListener('error', () => {
    if (state.intendToPlay) scheduleReconnect();
  });
  audio.addEventListener('ended', () => {
    if (state.intendToPlay) scheduleReconnect(); // live dropout
  });

  function reportPlayback() {
    // Report the user's intent so the views' play button and the tray label
    // track immediately (rather than waiting for buffering).
    window.wqxr.reportPlayback(state.intendToPlay);
  }

  // ---- OS media session ---------------------------------------------------

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const np = state.lastNowPlaying;
    const track = np && np.track;
    const show = np && np.show;

    const title = track ? track.title || track.composer || 'WQXR' : (currentStream() || {}).name || 'WQXR';
    const artist = (track && track.composer) || (show && show.title) || 'WQXR';
    const album = (show && show.title) || 'WQXR';
    const artwork = show && show.image ? [{ src: show.image, sizes: '300x300', type: 'image/png' }] : [];

    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album, artwork });
    } catch (_) {
      /* MediaMetadata may be unavailable on some platforms */
    }
    navigator.mediaSession.playbackState = state.intendToPlay ? 'playing' : 'paused';
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => play());
    navigator.mediaSession.setActionHandler('pause', () => stop());
    navigator.mediaSession.setActionHandler('stop', () => stop());
  }

  // ---- volume -------------------------------------------------------------

  function applyVolume() {
    audio.volume = state.volume;
    audio.muted = state.muted;
  }

  // ---- main -> engine wiring ----------------------------------------------

  function wire() {
    window.wqxr.onEngineCommand((cmd) => {
      if (cmd === 'play') play();
      else if (cmd === 'stop') stop();
      else if (cmd === 'toggle') toggle();
    });
    window.wqxr.onEngineSetStream((id) => setStream(id));
    window.wqxr.onEngineSetVolume((v) => {
      state.volume = Math.max(0, Math.min(1, v));
      applyVolume();
    });
    window.wqxr.onEngineSetMuted((m) => {
      state.muted = !!m;
      applyVolume();
    });
    window.wqxr.onNowPlaying((np) => {
      // Only the metadata matters here — streamId is owned by setStream/init.
      // (Letting now-playing mutate streamId races the engine:setStream command
      // and makes the "did the stream change?" guard skip playback.)
      state.lastNowPlaying = np;
      updateMediaSession();
    });
  }

  async function init() {
    setupMediaSession();
    wire();

    const initial = await window.wqxr.getInitialState();
    state.streams = initial.streams;
    state.streamId = initial.streamId;
    state.volume = initial.volume;
    state.muted = initial.muted;
    state.lastNowPlaying = initial.nowplaying || null;
    applyVolume();
    updateMediaSession();

    if (initial.autoplay) play(); // opt-in: start the last stream on launch
    console.log(`[engine] init ok (stream=${state.streamId}, autoplay=${!!initial.autoplay})`);
  }

  init();
})();
