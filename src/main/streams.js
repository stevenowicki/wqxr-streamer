'use strict';

// The WQXR family of live streams. Each entry carries the audio URLs (MP3 is the
// default; AAC is a lighter-weight fallback) plus the `slug` used by the WNYC
// "now playing" API (https://api.wnyc.org/api/v1/whats_on/{slug}/).
//
// These were verified live against the public endpoints. Nothing here is private
// or authenticated — it's the same data wqxr.org itself consumes.
const STREAMS = [
  {
    id: 'wqxr',
    name: 'WQXR 105.9',
    description: "New York's classical music station",
    slug: 'wqxr',
    mp3: 'https://stream.wqxr.org/wqxr',
    aac: 'https://stream.wqxr.org/wqxr.aac',
  },
  {
    id: 'q2',
    name: 'New Sounds',
    description: 'New and adventurous music',
    slug: 'q2',
    mp3: 'https://q2stream.wqxr.org/q2',
    aac: 'https://q2stream.wqxr.org/q2.aac',
  },
  {
    id: 'operavore',
    name: 'Operavore',
    description: 'Opera, around the clock',
    slug: 'operavore',
    mp3: 'https://opera-stream.wqxr.org/operavore',
    aac: 'https://opera-stream.wqxr.org/operavore.aac',
  },
];

const DEFAULT_STREAM_ID = 'wqxr';

function getStream(id) {
  return STREAMS.find((s) => s.id === id) || STREAMS.find((s) => s.id === DEFAULT_STREAM_ID);
}

module.exports = { STREAMS, DEFAULT_STREAM_ID, getStream };
