// TorBox — audiobook debrid source for SoundLoom (Zangetsu-style JS contract).
//
// Search: LAN provider proxy (preferred) → torrents-csv / SolidTorrents.
//   Phones behind UniFi SSL inspection often get HTML block pages for
//   torrent indexes; serve.py on the provider host proxies search instead.
// Playback: createtorrent → wait → requestdl for audio files.
//
// Settings: apiKey (required for unlock), cachedOnly, maxResults, preferM4b,
//           searchProxy (optional override).

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'torbox';

var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

var _TB_API = 'https://api.torbox.app/v1/api';
var _TORRENTS_CSV = 'https://torrents-csv.com/service/search';
var _SOLID = 'https://solidtorrents.to/api/v1/search';
var _unlockInflight = {};
var _AUDIO_EXT = /\.(m4b|mp3|m4a|flac|ogg|opus|aac|wma)$/i;
var _SAMPLE = /[\\/](?:sample|samples|trailer|extras?)[\\/]|\b(?:sample|trailer)\b/i;
var _AUDIO_HINT = /\b(?:audiobook|audio[\s._-]?book|m4b|unabridged|narrat|librivox|full[\s._-]?cast)\b|\.(?:mp3|m4b)\b/i;
var _VIDEO_HINT = /\b(?:1080p|2160p|720p|480p|bluray|blu[\s._-]?ray|brrip|webrip|web[\s._-]?dl|x264|x265|h\.?264|h\.?265|hevc|yts|mkv|remux|hdr|atmos|5\.1|7\.1|dts)\b/i;
/** iOS AVPlayer cannot decode these in .m4b (surround / E-AC-3 / Atmos rips). */
var _MOBILE_UNPLAYABLE = /\b(?:eac3|e-ac-3|atmos|truehd|dts-hd|\bdts\b|dd\+|dolby[\s._-]?digital[\s._-]?plus|5\.1|7\.1|6ch|surround)\b/i;

function getInfo() {
  return {
    name: 'TorBox',
    lang: 'en',
    baseUrl: 'https://torbox.app',
    logo: 'https://torbox.app/favicon.ico',
    type: 'audiobook',
    version: '2.1.10'
  };
}

function getSettings() {
  return [
    { key: 'apiKey', label: 'TorBox API key', type: 'text', default: '' },
    {
      key: 'cachedOnly',
      label: 'Cached torrents only',
      type: 'bool',
      default: true
    },
    {
      key: 'maxResults',
      label: 'Max search results',
      type: 'enum',
      default: '20',
      options: [
        { value: '10', label: '10' },
        { value: '20', label: '20' },
        { value: '40', label: '40' },
        { value: '60', label: '60' }
      ]
    },
    {
      key: 'preferM4b',
      label: 'Prefer .m4b files when unlocking',
      type: 'bool',
      default: true
    },
    {
      key: 'searchProxy',
      label: 'Search proxy URL (optional; defaults to provider host /api/torrent-search)',
      type: 'text',
      default: ''
    },
    {
      key: 'preferHls',
      label: 'Prefer TorBox HLS streaming (recommended on iPhone)',
      type: 'bool',
      default: true
    }
  ];
}

// ── helpers ────────────────────────────────────────────────────────────────
function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

function _settings() {
  try {
    var bag = (typeof __settings !== 'undefined' && __settings) ? __settings : {};
    return bag[SOURCE_ID] || {};
  } catch (e) { return {}; }
}

function _apiKey() { return _trim(_settings().apiKey || ''); }

function _cachedOnly() {
  var s = _settings();
  return s.cachedOnly !== false && s.cachedOnly !== 'false' && s.cachedOnly !== 0;
}

function _maxResults() {
  var n = parseInt(_settings().maxResults, 10);
  return isNaN(n) || n <= 0 ? 20 : n;
}

function _preferM4b() {
  var s = _settings();
  return s.preferM4b !== false && s.preferM4b !== 'false' && s.preferM4b !== 0;
}

function _hostPlatform() {
  try {
    return (typeof __HOST_PLATFORM !== 'undefined' && __HOST_PLATFORM)
      ? String(__HOST_PLATFORM).toLowerCase() : '';
  } catch (e) { return ''; }
}

function _preferHlsPlayback() {
  var s = _settings();
  if (s.preferHls === false || s.preferHls === 'false' || s.preferHls === 0) return false;
  if (s.preferHls === true || s.preferHls === 'true' || s.preferHls === 1) return true;
  return _hostPlatform() === 'ios';
}

function _naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function _fileSortKey(name) {
  return String(name || '').replace(/\\/g, '/');
}

function _log() {
  try {
    var args = ['[torbox]'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  } catch (e) {}
}

function _sizeLabel(bytes) {
  var n = Number(bytes) || 0;
  if (n <= 0) return '';
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
  if (n >= 1048576) return Math.round(n / 1048576) + ' MB';
  return Math.round(n / 1024) + ' KB';
}

function _basename(path) {
  var s = String(path || '');
  var i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

function _isAudioFile(name) {
  var n = String(name || '');
  if (!n || _SAMPLE.test(n)) return false;
  return _AUDIO_EXT.test(n);
}

function _isMobileSafeAudioName(name) {
  return !_MOBILE_UNPLAYABLE.test(String(name || ''));
}

function _containerFor(name) {
  var n = String(name || '').toLowerCase();
  if (n.endsWith('.m4b')) return 'm4b';
  if (n.endsWith('.mp3')) return 'mp3';
  if (n.endsWith('.m3u8')) return 'm3u8';
  return 'unknown';
}

function _playbackHeaders() {
  return {
    'User-Agent': UA,
    'Accept': '*/*',
    'Referer': 'https://torbox.app/'
  };
}

function _tbHeaders(key, extra) {
  var h = {
    'User-Agent': UA,
    'Accept': 'application/json',
    'Authorization': 'Bearer ' + key
  };
  if (extra) {
    for (var k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
    }
  }
  return h;
}

function _tbGet(path, key) {
  _log('GET', path);
  return fetch(_TB_API + path, {
    headers: _tbHeaders(key)
  }).then(function (r) {
    _log('GET', path, '←', r.status);
    return r.json().catch(function (e) {
      _log('GET JSON fail', path, String(e));
      return null;
    });
  }).catch(function (e) {
    _log('GET error', path, String(e));
    return null;
  });
}

function _tbPostForm(path, key, form) {
  _log('POST', path);
  return fetch(_TB_API + path, {
    method: 'POST',
    headers: _tbHeaders(key, { 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: form
  }).then(function (r) {
    _log('POST', path, '←', r.status);
    return r.json().catch(function (e) {
      _log('POST JSON fail', path, String(e));
      return null;
    });
  }).catch(function (e) {
    _log('POST error', path, String(e));
    return null;
  });
}

function _tbPostJson(path, key, body) {
  _log('POST', path, '(json)');
  return fetch(_TB_API + path, {
    method: 'POST',
    headers: _tbHeaders(key, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  }).then(function (r) {
    _log('POST', path, '←', r.status);
    return r.json().catch(function () { return null; });
  }).catch(function (e) {
    _log('POST error', path, String(e));
    return null;
  });
}

/** Remove a failed unlock attempt so metadl / uncached junk does not pile up. */
function _deleteTorrent(key, torrentId) {
  var id = parseInt(String(torrentId), 10);
  if (isNaN(id)) return Promise.resolve();
  return _tbPostJson('/torrents/controltorrent', key, {
    torrent_id: id,
    operation: 'delete',
    all: false
  }).then(function (j) {
    _log('controltorrent delete id=' + id, j && (j.detail || j.error || j.success));
  });
}

function _failUnlock(key, torrentId, reason) {
  _log('unlock cleanup:', reason);
  return _deleteTorrent(key, torrentId).then(function () { return []; });
}

function _parseAuthor(title) {
  var t = String(title || '');
  var m = t.match(/^(.+?)\s+-\s+(.+)$/);
  if (!m) return { title: t, author: '' };
  if (m[1].length >= m[2].length) return { title: m[1], author: m[2] };
  return { title: m[2], author: m[1] };
}

function _sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function _magnetFromHash(hash, title) {
  var h = String(hash || '').toLowerCase().replace(/[^a-f0-9]/g, '');
  if (h.length !== 40 && h.length !== 32) return '';
  var mag = 'magnet:?xt=urn:btih:' + h;
  if (title) mag += '&dn=' + encodeURIComponent(String(title).slice(0, 180));
  return mag;
}

function _hashFromMagnet(magnet) {
  var m = String(magnet || '').match(/btih:([a-f0-9]{32,40})/i);
  return m ? m[1].toLowerCase() : _trim(magnet);
}

function _normalizedCreate(j) {
  if (!j) return null;
  if (j.success !== false) return j;
  var tid = _torrentIdFromCreate(j);
  var err = String(j.error || j.detail || '');
  if (tid != null && /duplicate/i.test(err)) {
    _log('createtorrent duplicate — reusing torrent_id=' + tid);
    return { success: true, data: { torrent_id: tid } };
  }
  return j;
}

function _normalizeQuery(query) {
  // SolidTorrents is picky about apostrophes / curly quotes.
  var q = _trim(query)
    .replace(/[\u2018\u2019\u201A\u201B']/g, '')
    .replace(/[\u201C\u201D\u201E\u201F"]/g, '')
    .replace(/\s+/g, ' ');
  return q;
}

/** Build several search strings from an Audible-style title. */
function _queryVariants(query) {
  var base = _normalizeQuery(query);
  if (!base) return [];
  var seen = {};
  var out = [];
  function add(s) {
    s = _normalizeQuery(s);
    if (!s || seen[s.toLowerCase()]) return;
    seen[s.toLowerCase()] = true;
    out.push(s);
  }
  add(base);
  // "Title, Book 1" / "Title Book 1" → drop volume suffix
  add(base.replace(/,?\s*book\s*\d+\s*$/i, ''));
  add(base.replace(/,?\s*\(book\s*\d+\)\s*$/i, ''));
  // Drop trailing series noise after colon
  add(base.replace(/:\s*.+$/, ''));
  // Prefer audiobook-biased forms first
  var withAb = [];
  for (var i = 0; i < out.length; i++) {
    if (!/\baudiobook\b/i.test(out[i])) withAb.push(out[i] + ' audiobook');
  }
  return withAb.concat(out);
}

function _scoreHit(title, seeders, size) {
  var t = String(title || '');
  var seeds = Number(seeders) || 0;
  // Cap seeder weight so movie rips cannot bury audiobooks.
  var score = Math.min(seeds, 80) * 5;
  var audio = _AUDIO_HINT.test(t) || _AUDIO_EXT.test(t);
  var video = _VIDEO_HINT.test(t);
  if (audio) score += 8000;
  if (/\.m4b\b/i.test(t)) score += 1500;
  if (video && !audio) score -= 20000;
  if (_MOBILE_UNPLAYABLE.test(t)) score -= 25000;
  var n = Number(size) || 0;
  if (n >= 5e7 && n <= 3.5e9) score += 120;
  if (n > 5e9 && !audio) score -= 5000;
  return score;
}

// ── Free-text torrent search (Torrentio cannot do this for audiobooks) ─────
function _searchProxyBase() {
  var custom = _trim(_settings().searchProxy || '');
  if (custom) return custom.replace(/\/+$/, '');
  var origin = '';
  try {
    origin = (typeof __PROVIDER_ORIGIN !== 'undefined' && __PROVIDER_ORIGIN)
      ? String(__PROVIDER_ORIGIN) : '';
  } catch (e) {}
  if (!origin) return '';
  // Only use LAN/http origins as an automatic proxy (not raw.githubusercontent).
  if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(origin)
    || /^http:\/\//i.test(origin)) {
    return origin.replace(/\/+$/, '') + '/api/torrent-search';
  }
  return '';
}

function _looksLikeHtml(body) {
  var s = _trim(body).slice(0, 80).toLowerCase();
  return !s || s.charAt(0) === '<' || s.indexOf('<!doctype') === 0 || s.indexOf('<html') === 0;
}

function _parseJsonBody(r, label) {
  var body = r && r.body != null ? String(r.body) : '';
  if (_looksLikeHtml(body)) {
    _log(label, 'got HTML (' + body.length + ' bytes) — likely gateway/SSL block (UniFi)');
    return null;
  }
  try { return JSON.parse(body); } catch (e) {
    _log(label, 'JSON parse failed', String(e), 'bytes=' + body.length);
    return null;
  }
}

function _mapRows(rows) {
  var scored = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var hash = r.infohash || r.infoHash || r.hash || '';
    var title = r.title || r.name || 'Audiobook';
    var magnet = _magnetFromHash(hash, title);
    if (!magnet) continue;
    var size = Number(r.size_bytes != null ? r.size_bytes : r.size) || 0;
    var seeds = Number(r.seeders) || 0;
    var parts = _parseAuthor(title);
    scored.push({
      id: magnet,
      title: parts.title || title,
      author: parts.author || '',
      url: magnet,
      detailUrl: magnet,
      size: size,
      sizeLabel: _sizeLabel(size),
      seeders: seeds,
      source: 'torbox',
      _score: _scoreHit(title, seeds, size)
    });
  }
  scored.sort(function (a, b) { return (b._score || 0) - (a._score || 0); });
  return scored;
}

function _proxySearchOnce(q, limit) {
  var base = _searchProxyBase();
  if (!base) return Promise.resolve([]);
  var url = base
    + (base.indexOf('?') >= 0 ? '&' : '?')
    + 'q=' + encodeURIComponent(q)
    + '&limit=' + encodeURIComponent(String(limit));
  _log('proxySearch', url);
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  }).then(function (r) {
    _log('proxySearch HTTP', r.status);
    var j = _parseJsonBody(r, 'proxySearch');
    var rows = (j && j.results) || [];
    if (!Array.isArray(rows)) rows = [];
    _log('proxySearch results=', rows.length);
    return rows;
  }).catch(function (e) {
    _log('proxySearch error', String(e));
    return [];
  });
}

function _csvSearchOnce(q, limit) {
  var url = _TORRENTS_CSV
    + '?q=' + encodeURIComponent(q)
    + '&size=' + encodeURIComponent(String(limit));
  _log('torrents-csv q="' + q + '" size=' + limit);
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  }).then(function (r) {
    _log('torrents-csv HTTP', r.status);
    var j = _parseJsonBody(r, 'torrents-csv');
    var rows = (j && j.torrents) || [];
    if (!Array.isArray(rows)) rows = [];
    _log('torrents-csv results=', rows.length);
    return rows;
  }).catch(function (e) {
    _log('torrents-csv error', String(e));
    return [];
  });
}

function _solidSearchOnce(q, limit) {
  var url = _SOLID
    + '?q=' + encodeURIComponent(q)
    + '&limit=' + encodeURIComponent(String(limit))
    + '&sort=seeders'
    + '&order=desc';
  _log('solidtorrents q="' + q + '" limit=' + limit);
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  }).then(function (r) {
    _log('solidtorrents HTTP', r.status);
    var j = _parseJsonBody(r, 'solidtorrents');
    var rows = (j && j.results) || [];
    if (!Array.isArray(rows)) rows = [];
    _log('solidtorrents results=', rows.length);
    return rows;
  }).catch(function (e) {
    _log('solidtorrents error', String(e));
    return [];
  });
}

function _indexSearch(query, page) {
  var variants = _queryVariants(query);
  if (!variants.length) return Promise.resolve([]);

  var limit = _maxResults();
  var fetchLimit = Math.min(100, limit * Math.max(1, page || 1));
  var merged = [];
  var seenHash = {};

  function absorb(rows) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      var h = String(r.infohash || r.infoHash || r.hash || '').toLowerCase();
      if (h && seenHash[h]) continue;
      if (h) seenHash[h] = true;
      merged.push(r);
    }
  }

  function finish() {
    var scored = _mapRows(merged);
    var start = Math.max(0, ((page || 1) - 1) * limit);
    var out = scored.slice(start, start + limit).map(function (hit) {
      delete hit._score;
      return hit;
    });
    _log('indexSearch parsed=', out.length, 'from', merged.length, 'variants=', variants.length);
    return out;
  }

  // LAN proxy (serve.py) already expands query variants server-side — one call.
  // Direct indexes still try each variant when the proxy is empty/unavailable.
  function runDirect(i) {
    if (i >= variants.length) return Promise.resolve(finish());
    return _csvSearchOnce(variants[i], fetchLimit).then(function (rows) {
      absorb(rows);
      return _solidSearchOnce(variants[i], fetchLimit).then(function (rows2) {
        absorb(rows2);
        if (merged.length >= limit) return finish();
        return runDirect(i + 1);
      });
    });
  }

  if (_searchProxyBase()) {
    return _proxySearchOnce(query, fetchLimit).then(function (rows) {
      absorb(rows);
      if (merged.length) return finish();
      _log('proxy empty — falling back to direct indexes');
      return runDirect(0);
    });
  }
  return runDirect(0);
}

// ── unlock ─────────────────────────────────────────────────────────────────
function _createTorrent(key, magnet, cachedOnly) {
  var form = 'magnet=' + encodeURIComponent(magnet) + '&allow_zip=false';
  if (cachedOnly) form += '&add_only_if_cached=true';
  return _tbPostForm('/torrents/createtorrent', key, form);
}

function _torrentIdFromCreate(j) {
  if (!j) return null;
  var d = j.data;
  if (d && typeof d === 'object') {
    if (d.torrent_id != null) return d.torrent_id;
    if (d.id != null) return d.id;
  }
  return null;
}

function _getTorrentById(key, id) {
  return _tbGet(
    '/torrents/mylist?id=' + encodeURIComponent(String(id)) + '&bypass_cache=true',
    key
  ).then(function (j) {
    var d = j && j.data;
    if (!d) return null;
    return Array.isArray(d) ? (d[0] || null) : d;
  });
}

function _requestDl(key, torrentId, fileId) {
  var q = 'token=' + encodeURIComponent(key)
    + '&torrent_id=' + encodeURIComponent(String(torrentId))
    + '&file_id=' + encodeURIComponent(String(fileId))
    + '&redirect=false';
  return _tbGet('/torrents/requestdl?' + q, key).then(function (j) {
    if (!j || j.success === false) return null;
    var d = j.data;
    if (typeof d === 'string' && /^https?:\/\//i.test(d)) return d;
    if (d && typeof d === 'object') {
      if (d.url) return d.url;
      if (d.link) return d.link;
      if (d.download) return d.download;
    }
    return null;
  });
}

/** TorBox transcoded HLS — works on iOS where raw CDN .m4b often fails (-11828). */
function _webStreamUrl(key, torrentId, fileId) {
  var cq = 'id=' + encodeURIComponent(String(torrentId))
    + '&file_id=' + encodeURIComponent(String(fileId))
    + '&type=torrent';
  return _tbGet('/stream/createstream?' + cq, key).then(function (j) {
    if (!j || j.success === false) {
      _log('createstream failed', j && (j.error || j.detail));
      return null;
    }
    var data = j.data;
    var presigned = (data && (data.presigned_token || data.presignedToken)) || null;
    if (!presigned) return null;
    var dq = 'presigned_token=' + encodeURIComponent(String(presigned))
      + '&token=' + encodeURIComponent(key);
    return _tbGet('/stream/getstreamdata?' + dq, key).then(function (j2) {
      if (!j2 || j2.success === false) {
        _log('getstreamdata failed', j2 && (j2.error || j2.detail));
        return null;
      }
      var hls = j2.data && j2.data.hls_url;
      return (typeof hls === 'string' && /^https?:\/\//i.test(hls)) ? hls : null;
    });
  }).catch(function (e) {
    _log('webStreamUrl error', String(e));
    return null;
  });
}

function _playbackUrl(key, torrentId, fileId) {
  if (!_preferHlsPlayback()) return _requestDl(key, torrentId, fileId);
  return _webStreamUrl(key, torrentId, fileId).then(function (hls) {
    if (hls) {
      _log('playback using HLS');
      return hls;
    }
    _log('HLS unavailable — falling back to requestdl');
    return _requestDl(key, torrentId, fileId);
  });
}

function _pickAudioFiles(files) {
  var list = Array.isArray(files) ? files : [];
  var audio = [];
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    if (!f || typeof f !== 'object') continue;
    var name = f.name || f.filename || f.short_name || '';
    if (_isAudioFile(name)) audio.push(f);
  }
  if (!audio.length) return [];

  if (_preferM4b()) {
    var m4b = audio.filter(function (f) {
      return /\.m4b$/i.test(f.name || f.filename || '');
    });
    if (m4b.length) audio = m4b;
  }

  var mobileSafe = audio.filter(function (f) {
    var name = f.name || f.filename || f.short_name || '';
    return _isMobileSafeAudioName(name);
  });
  if (mobileSafe.length) {
    if (mobileSafe.length < audio.length) {
      _log('pickAudioFiles: prefer', mobileSafe.length, 'mobile-safe over', audio.length);
    }
    audio = mobileSafe;
  } else if (audio.length) {
    _log('pickAudioFiles: warning — only surround/Atmos audio in torrent');
  }

  audio.sort(function (a, b) {
    var na = _fileSortKey(a.name || a.filename || a.short_name || '');
    var nb = _fileSortKey(b.name || b.filename || b.short_name || '');
    return _naturalCompare(na, nb);
  });
  return audio;
}

function _torrentState(t) {
  return String(t.download_state || t.downloadState || '').toLowerCase();
}

function _torrentFiles(t) {
  var files = t.files || t.file_list || [];
  return Array.isArray(files) ? files : [];
}

/** Metadata-only add with no file list yet — not playable; do not spin for minutes. */
function _stuckWithoutFiles(t) {
  var state = _torrentState(t);
  var fileCount = _torrentFiles(t).length;
  if (fileCount > 0) return false;
  return state === 'metadl'
    || state === 'meta_dl'
    || state.indexOf('meta') === 0;
}

function _waitReady(key, torrentId, attempts, opts) {
  opts = opts || {};
  var cachedOnly = opts.cachedOnly === true;
  var maxAttempts = attempts == null ? (cachedOnly ? 4 : 12) : attempts;
  var left = maxAttempts;
  var metaStuckTicks = 0;
  function tick() {
    return _getTorrentById(key, torrentId).then(function (t) {
      if (!t) {
        _log('waitReady id=' + torrentId + ' missing left=' + left);
        if (left-- <= 0) return null;
        return _sleep(800).then(tick);
      }
      var state = _torrentState(t);
      var progress = Number(t.progress);
      var files = _torrentFiles(t);
      var fileCount = files.length;
      _log('waitReady id=' + torrentId + ' state=' + state + ' progress=' + progress + ' files=' + fileCount + ' left=' + left);

      if (fileCount > 0 && (state === 'completed' || state === 'cached' || progress === 1)) {
        return t;
      }
      if (state === 'cached' && fileCount > 0) return t;
      if (fileCount > 0 && state.indexOf('error') < 0 && (state === 'downloading' ? progress >= 0.99 : true)) {
        return t;
      }

      if (_stuckWithoutFiles(t)) {
        metaStuckTicks++;
        if (cachedOnly || metaStuckTicks >= 3) {
          _log('waitReady abort — not cached / metadata not ready');
          return null;
        }
      } else {
        metaStuckTicks = 0;
      }

      if (left-- <= 0) {
        _log('waitReady timeout');
        return null;
      }
      return _sleep(800).then(tick);
    });
  }
  return tick();
}

function _unlockAfterCreate(key, created) {
  var torrentId = _torrentIdFromCreate(created);
  if (torrentId == null) return Promise.reject('No torrent_id from TorBox');
  _log('torrentId=', torrentId);

  var cachedOnly = _cachedOnly();
  return _waitReady(key, torrentId, null, { cachedOnly: cachedOnly }).then(function (torrent) {
    if (!torrent) {
      return _failUnlock(key, torrentId, 'torrent never became ready');
    }
    var rawFiles = torrent.files || torrent.file_list || [];
    var files = _pickAudioFiles(rawFiles);
    _log('unlock files raw=' + (Array.isArray(rawFiles) ? rawFiles.length : 0) + ' audio=' + files.length);
    if (!files.length) {
      return _failUnlock(key, torrentId, 'no audio files (not cached or metadata stuck)');
    }

    var take = files.slice(0, 12);
    return Promise.all(take.map(function (f) {
      var fileId = f.id != null ? f.id : f.file_id;
      var name = f.name || f.filename || 'audio';
      if (fileId == null) {
        _log('skip file without id', name);
        return null;
      }
      return _playbackUrl(key, torrentId, fileId).then(function (url) {
        _log('playback', name, '→', url ? 'ok' : 'null');
        if (!url) return null;
        var isHls = /\.m3u8(\?|$)/i.test(url);
        return {
          url: url,
          label: _basename(name) + (isHls ? ' · HLS' : ''),
          container: isHls ? 'm3u8' : _containerFor(name),
          quality: _sizeLabel(f.size),
          headers: _playbackHeaders()
        };
      });
    })).then(function (rows) {
      var out = [];
      for (var i = 0; i < rows.length; i++) if (rows[i]) out.push(rows[i]);
      _log('unlock →', out.length, 'stream(s)');
      if (!out.length) {
        return _failUnlock(key, torrentId, 'no playable streams');
      }
      return out;
    });
  });
}

function _createTorrentForUnlock(key, magnet, cachedOnly) {
  return _createTorrent(key, magnet, cachedOnly).then(function (created) {
    _log('createtorrent response', created && {
      success: created.success,
      error: created.error,
      detail: created.detail,
      data: created.data
    });
    created = _normalizedCreate(created);
    if (created && created.success !== false) return created;

    var err = (created && (created.error || created.detail)) || 'createtorrent failed';
    var errStr = String(err);
    if (cachedOnly && /DOWNLOAD_NOT_CACHED|not found in cache|only if cached/i.test(errStr)) {
      _log('not cached (cachedOnly) — abort');
      return Promise.reject('Torrent not in TorBox cache');
    }
    if (!cachedOnly && /DOWNLOAD_NOT_CACHED|not found in cache|only if cached/i.test(errStr)) {
      _log('not cached — retrying createtorrent without cache requirement');
      return _createTorrent(key, magnet, false).then(function (created2) {
        created2 = _normalizedCreate(created2);
        if (!created2 || created2.success === false) {
          var err2 = (created2 && (created2.error || created2.detail)) || 'createtorrent failed';
          return Promise.reject(String(err2));
        }
        return created2;
      });
    }
    return Promise.reject(errStr);
  });
}

function _unlockMagnetWork(key, magnet) {
  var cachedOnly = _cachedOnly();
  _log('unlock cachedOnly=' + cachedOnly + ' magnet=' + String(magnet).slice(0, 72));
  return _createTorrentForUnlock(key, magnet, cachedOnly).then(function (created) {
    return _unlockAfterCreate(key, created);
  });
}

function _unlockMagnet(magnet) {
  var key = _apiKey();
  if (!key) return Promise.reject('TorBox API key not configured');
  if (!magnet || !/^magnet:/i.test(magnet)) {
    return Promise.reject('Expected a magnet link');
  }

  var hash = _hashFromMagnet(magnet);
  if (_unlockInflight[hash]) {
    _log('unlock join in-flight hash=' + hash.slice(0, 12));
    return _unlockInflight[hash];
  }

  var run = _unlockMagnetWork(key, magnet).finally(function () {
    delete _unlockInflight[hash];
  });
  _unlockInflight[hash] = run;
  return run;
}

// ── contract ───────────────────────────────────────────────────────────────
function search(query, page) {
  if (!_trim(query)) {
    _log('search empty query');
    return Promise.resolve([]);
  }
  // Search does not need the TorBox key (indexes are public). Unlock does.
  return _indexSearch(query, page || 1);
}

function getDetail(url) {
  var magnet = _trim(url);
  var title = 'Audiobook';
  var m = magnet.match(/[?&]dn=([^&]+)/i);
  if (m) {
    try { title = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { title = m[1]; }
  }
  var parts = _parseAuthor(title);
  return Promise.resolve({
    url: magnet,
    title: parts.title || title,
    author: parts.author || '',
    asin: null
  });
}

function getAudioSources(url) {
  _log('getAudioSources', String(url || '').slice(0, 96));
  return _unlockMagnet(_trim(url)).catch(function (e) {
    _log('getAudioSources FAILED', String(e));
    return [];
  });
}

function getVideoSources(url) {
  return getAudioSources(url);
}
