'use strict';

// The view controller for the popover / main window. It owns no audio — it just
// renders state pushed from the main process and forwards user intents. The
// hidden engine window (engine.js) is the single source of truth for playback.
(function () {
  const state = {
    streamId: null,
    volume: 0.85,
    muted: false,
    isPlaying: false,
  };

  window.addEventListener('error', (e) => {
    console.error('[wqxr] view error:', e.message, e.filename + ':' + e.lineno);
  });

  // ---- apply incoming state ----------------------------------------------

  function applyState(s) {
    if (typeof s.streamId === 'string') {
      state.streamId = s.streamId;
      UI.setSelectedStream(s.streamId);
    }
    if (typeof s.isPlaying === 'boolean') {
      state.isPlaying = s.isPlaying;
      UI.setPlaying(s.isPlaying);
      UI.setLoading(false);
    }
    if (typeof s.volume === 'number') state.volume = s.volume;
    if (typeof s.muted === 'boolean') state.muted = s.muted;
    if (typeof s.volume === 'number' || typeof s.muted === 'boolean') {
      UI.setVolumeUI(state.volume, state.muted);
    }
  }

  // ---- user intents -> main ----------------------------------------------

  function wireControls() {
    UI.els['play-btn'].addEventListener('click', () => {
      // Optimistic: show intent immediately; the engine's report corrects it.
      UI.setLoading(!state.isPlaying);
      window.wqxr.toggle();
    });
    UI.els['mute-btn'].addEventListener('click', () => window.wqxr.setMuted(!state.muted));
    UI.els['volume-slider'].addEventListener('input', (e) => {
      state.volume = parseFloat(e.target.value);
      if (state.volume > 0) state.muted = false;
      UI.setVolumeUI(state.volume, state.muted);
      window.wqxr.setVolume(state.volume);
    });
    UI.els['stream-select'].addEventListener('change', (e) => window.wqxr.setStream(e.target.value));
    UI.els['show-link'].addEventListener('click', (e) => {
      e.preventDefault();
      const url = e.currentTarget.dataset.url;
      if (url) window.wqxr.openLink(url);
    });
    UI.els['show-image'].addEventListener('error', () => {
      document.querySelector('.artwork').classList.remove('has-image');
    });
  }

  function wireIpc() {
    window.wqxr.onState((s) => applyState(s));
    window.wqxr.onNowPlaying((np) => UI.renderNowPlaying(np));
  }

  async function init() {
    document.body.dataset.mode = window.wqxr.mode;
    UI.cache();
    wireControls();
    wireIpc();

    const initial = await window.wqxr.getInitialState();
    UI.populateStreams(initial.streams, initial.streamId);
    applyState(initial);
    if (initial.nowplaying) UI.renderNowPlaying(initial.nowplaying);

    console.log(`[wqxr] view init ok (mode=${window.wqxr.mode}, stream=${state.streamId})`);
  }

  init();
})();
