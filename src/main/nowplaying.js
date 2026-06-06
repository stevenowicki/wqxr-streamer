'use strict';

const { EventEmitter } = require('events');
const { getStream } = require('./streams');

// Polls the public WNYC "now playing" API for the active stream, normalizes the
// payload, maintains a rolling "recently played" history, and emits `update`
// events that the rest of the app (renderer, tray, media session) consumes.
//
// Endpoints (no auth):
//   whats_on/{slug}/                  -> current show + current track
//   playlist-daily/{slug}/Y/mon/D/    -> the day's tracks, used to seed history

const API = 'https://api.wnyc.org/api/v1';
const POLL_FLOOR_MS = 15 * 1000;
const POLL_CEILING_MS = 5 * 60 * 1000;
const FALLBACK_POLL_MS = 25 * 1000;
const HISTORY_CAP = 20;

class NowPlaying extends EventEmitter {
  constructor() {
    super();
    this.streamId = null;
    this.slug = null;
    this.current = null; // last normalized payload
    this.playedList = []; // every track played today, most-recent first (incl. current)
    this.playedKeys = new Set();
    this.timer = null;
    this.generation = 0; // bumped on every stream switch to cancel stale async work
  }

  get state() {
    const currentKey = this.current && this.current.track ? this.current.track.key : null;
    // "Recently played" is what came *before* now — exclude the current track.
    const history = this.playedList
      .filter((t) => t.key !== currentKey)
      .slice(0, HISTORY_CAP);
    return {
      streamId: this.streamId,
      show: this.current ? this.current.show : null,
      track: this.current ? this.current.track : null,
      history,
    };
  }

  // Switch to a stream: reset history, seed it from the daily playlist, then poll.
  async setStream(streamId) {
    const stream = getStream(streamId);
    this.streamId = stream.id;
    this.slug = stream.slug;
    this.current = null;
    this.playedList = [];
    this.playedKeys = new Set();
    this.generation += 1;
    const gen = this.generation;

    this._clearTimer();
    this.emit('update', this.state); // immediately reflect the (empty) switch

    await this._seedHistory(gen);
    await this._poll(gen);
  }

  stop() {
    this._clearTimer();
  }

  _clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async _fetchJSON(url) {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }

  // Seed the recently-played list from today's daily playlist so history isn't
  // empty on launch. Best-effort: failures here are non-fatal.
  async _seedHistory(gen) {
    try {
      const datePath = etDatePath();
      const url = `${API}/playlist-daily/${this.slug}/${datePath}/`;
      const data = await this._fetchJSON(url);
      if (gen !== this.generation) return; // stream switched mid-flight

      const played = [];
      for (const ev of data.events || []) {
        for (const pl of ev.playlists || []) {
          for (const item of pl.played || []) {
            const t = normalizeTrack(item.info, item.iso_start_time);
            if (t) played.push(t);
          }
        }
      }
      // Most-recent first, deduped. Keep a little extra beyond HISTORY_CAP so
      // that filtering out the current track still leaves a full list.
      played.sort((a, b) => (b.startTs || 0) - (a.startTs || 0));
      const keys = new Set();
      const deduped = [];
      for (const t of played) {
        if (keys.has(t.key)) continue;
        keys.add(t.key);
        deduped.push(t);
        if (deduped.length >= HISTORY_CAP + 5) break;
      }
      this.playedList = deduped;
      this.playedKeys = keys;
    } catch (err) {
      console.error('[nowplaying] history seed failed:', err.message);
    }
  }

  async _poll(gen) {
    if (gen !== this.generation) return;
    let nextMs = FALLBACK_POLL_MS;
    try {
      const url = `${API}/whats_on/${this.slug}/`;
      const data = await this._fetchJSON(url);
      if (gen !== this.generation) return;

      const show = normalizeShow(data.current_show);
      const item = data.current_playlist_item;
      const track = item ? normalizeTrack(item.catalog_entry, item.iso_start_time || item.start_time, item) : null;

      // Record newly-seen tracks into the played list (live fallback for tracks
      // newer than the seeded daily playlist). It stays out of "recently played"
      // while it's the current track, then appears once the next track begins.
      if (track && !this.playedKeys.has(track.key)) {
        this.playedKeys.add(track.key);
        this.playedList = [track, ...this.playedList].slice(0, HISTORY_CAP + 5);
      }

      this.current = { show, track };
      this.emit('update', this.state);

      nextMs = this._nextPollDelay(item);
    } catch (err) {
      console.error('[nowplaying] poll failed:', err.message);
      nextMs = FALLBACK_POLL_MS;
    } finally {
      if (gen === this.generation) {
        this._clearTimer();
        this.timer = setTimeout(() => this._poll(gen), nextMs);
      }
    }
  }

  // Prefer scheduling the next poll for just after the current track is due to
  // end (start_time_ts + length). Falls back to a steady interval otherwise.
  _nextPollDelay(item) {
    try {
      const startTs = item && item.start_time_ts;
      const length = item && item.catalog_entry && item.catalog_entry.length;
      if (startTs && length) {
        const endMs = (startTs + length) * 1000 + 3000;
        const delay = endMs - Date.now();
        return clamp(delay, POLL_FLOOR_MS, POLL_CEILING_MS);
      }
    } catch (_) {
      /* fall through */
    }
    return FALLBACK_POLL_MS;
  }
}

// --- normalization helpers -------------------------------------------------

function nameOf(obj) {
  return obj && typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : null;
}

function normalizeShow(cs) {
  if (!cs || !cs.title) return null;
  const img = cs.fullImage || cs.detailImage || cs.listImage || null;
  return {
    title: cs.title,
    description: cs.description || null,
    image: img && img.url ? img.url : null,
    url: cs.show_url || cs.url || null,
  };
}

// Works for both whats_on `catalog_entry` and playlist-daily `info` (same shape).
function normalizeTrack(entry, startISO, parent) {
  if (!entry) return null;
  const title = entry.title || null;
  const composer = nameOf(entry.composer);
  if (!title && !composer) return null;

  const soloists = Array.isArray(entry.soloists)
    ? entry.soloists.map(nameOf).filter(Boolean)
    : [];

  const startTs = parseStartTs(startISO, parent);
  const key = `${composer || ''}|${title || ''}|${startTs || ''}`;

  return {
    title,
    composer,
    conductor: nameOf(entry.conductor),
    ensemble: nameOf(entry.ensemble),
    soloists,
    label: nameOf(entry.reclabel),
    url: entry.url || null,
    startTs,
    key,
  };
}

function parseStartTs(startISO, parent) {
  if (parent && typeof parent.start_time_ts === 'number') return Math.round(parent.start_time_ts);
  if (typeof startISO === 'string') {
    const ms = Date.parse(startISO);
    if (!Number.isNaN(ms)) return Math.round(ms / 1000);
  }
  return null;
}

// Build the America/New_York date path (Y/mon/D, e.g. 2026/jun/01) the daily
// playlist endpoint expects — the station runs on Eastern time.
function etDatePath() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}/${get('month').toLowerCase()}/${get('day')}`;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

module.exports = new NowPlaying();
