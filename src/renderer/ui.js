'use strict';

// Pure rendering: takes normalized state from the main process and paints the
// DOM. No audio or IPC logic lives here (see player.js for that).
window.UI = (function () {
  const $ = (id) => document.getElementById(id);

  const els = {};
  function cache() {
    [
      'stream-select', 'show-image', 'artwork-fallback', 'show-name',
      'track', 'track-composer', 'track-title', 'track-performers',
      'show-link', 'play-btn', 'icon-play', 'icon-pause', 'mute-btn',
      'icon-vol', 'icon-muted', 'volume-slider', 'status', 'history-list',
    ].forEach((id) => (els[id] = $(id)));
    els.artwork = document.querySelector('.artwork');
  }

  function populateStreams(streams, currentId) {
    els['stream-select'].innerHTML = '';
    for (const s of streams) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === currentId) opt.selected = true;
      els['stream-select'].appendChild(opt);
    }
  }

  function setSelectedStream(id) {
    if (els['stream-select'].value !== id) els['stream-select'].value = id;
  }

  // Join the conductor / ensemble / soloists into one readable line.
  function performersLine(track) {
    const parts = [];
    if (track.ensemble) parts.push(track.ensemble);
    if (track.conductor) parts.push(track.conductor);
    if (track.soloists && track.soloists.length) parts.push(track.soloists.join(', '));
    return parts.join(' · ');
  }

  function renderNowPlaying(state) {
    const show = state.show;
    const track = state.track;

    // Artwork + show name.
    if (show && show.image) {
      els['show-image'].src = show.image;
      els.artwork.classList.add('has-image');
    } else {
      els['show-image'].removeAttribute('src');
      els.artwork.classList.remove('has-image');
    }
    els['show-name'].textContent = show ? show.title : '';

    // Show link (opens externally via player.js handler).
    if (show && show.url) {
      els['show-link'].hidden = false;
      els['show-link'].dataset.url = show.url;
    } else {
      els['show-link'].hidden = true;
      delete els['show-link'].dataset.url;
    }

    // Current track.
    if (track) {
      els['track-composer'].textContent = track.composer || '';
      els['track-title'].textContent = track.title || '';
      els['track-performers'].textContent = performersLine(track);
    } else {
      els['track-composer'].textContent = '';
      els['track-title'].textContent = show ? '' : 'Live stream';
      els['track-performers'].textContent = '';
    }

    renderHistory(state.history || []);
  }

  function renderHistory(history) {
    const list = els['history-list'];
    list.innerHTML = '';
    if (!history.length) {
      const li = document.createElement('li');
      li.className = 'history-empty';
      li.textContent = 'Nothing logged yet.';
      list.appendChild(li);
      return;
    }
    for (const t of history) {
      const li = document.createElement('li');

      const main = document.createElement('div');
      main.className = 'h-main';
      const composer = document.createElement('span');
      composer.className = 'h-composer';
      composer.textContent = t.composer ? `${t.composer}: ` : '';
      main.appendChild(composer);
      main.appendChild(document.createTextNode(t.title || ''));
      li.appendChild(main);

      const sub = performersLine(t);
      if (sub) {
        const subEl = document.createElement('div');
        subEl.className = 'h-sub';
        subEl.textContent = sub;
        li.appendChild(subEl);
      }

      if (t.startTs) {
        const time = document.createElement('div');
        time.className = 'h-time';
        time.textContent = formatTime(t.startTs);
        li.appendChild(time);
      }
      list.appendChild(li);
    }
  }

  function formatTime(ts) {
    try {
      return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function setPlaying(playing) {
    els['icon-play'].hidden = playing;
    els['icon-pause'].hidden = !playing;
    els['play-btn'].setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  function setLoading(loading) {
    els['play-btn'].classList.toggle('loading', loading);
  }

  function setStatus(text, isError) {
    els['status'].textContent = text || '';
    els['status'].classList.toggle('error', !!isError);
  }

  function setVolumeUI(volume, muted) {
    els['volume-slider'].value = muted ? 0 : volume;
    els['icon-vol'].hidden = muted;
    els['icon-muted'].hidden = !muted;
  }

  return {
    cache,
    populateStreams,
    setSelectedStream,
    renderNowPlaying,
    setPlaying,
    setLoading,
    setStatus,
    setVolumeUI,
    els,
  };
})();
