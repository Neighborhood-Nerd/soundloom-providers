// Torrents CSV — magnet search index for SoundLoom (unlock via app Downloaders).

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'torrentscsv';

var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

var _TORRENTS_CSV = 'https://torrents-csv.com/service/search';
var _AUDIO_EXT = /\.(m4b|mp3|m4a|flac|ogg|opus|aac|wma)$/i;
var _AUDIO_HINT = /\b(?:audiobook|audio[\s._-]?book|m4b|unabridged|narrat|librivox|full[\s._-]?cast)\b|\.(?:mp3|m4b)\b/i;
var _VIDEO_HINT = /\b(?:1080p|2160p|720p|480p|bluray|blu[\s._-]?ray|brrip|webrip|web[\s._-]?dl|x264|x265|h\.?264|h\.?265|hevc|yts|mkv|remux|hdr|atmos|5\.1|7\.1|dts)\b/i;
var _MOBILE_UNPLAYABLE = /\b(?:eac3|e-ac-3|atmos|truehd|dts-hd|\bdts\b|dd\+|dolby[\s._-]?digital[\s._-]?plus|5\.1|7\.1|6ch|surround)\b/i;

function getInfo() {
  return {
    name: 'Torrents CSV',
    lang: 'en',
    baseUrl: 'https://torrents-csv.com',
    logo: 'https://torrents-csv.com/favicon.ico',
    type: 'audiobook',
    version: '1.0.3'
  };
}

function getSettings() {
  return [
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
    }
  ];
}

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

function _settings() {
  try {
    var bag = (typeof __settings !== 'undefined' && __settings) ? __settings : {};
    return bag[SOURCE_ID] || {};
  } catch (e) { return {}; }
}

function _maxResults() {
  var n = parseInt(_settings().maxResults, 10);
  return isNaN(n) || n <= 0 ? 20 : n;
}

function _log() {
  try {
    var args = ['[torrentscsv]'];
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

function _parseAuthor(title) {
  var t = String(title || '');
  var m = t.match(/^(.+?)\s+-\s+(.+)$/);
  if (!m) return { title: t, author: '' };
  if (m[1].length >= m[2].length) return { title: m[1], author: m[2] };
  return { title: m[2], author: m[1] };
}

function _magnetFromHash(hash, title) {
  var h = String(hash || '').toLowerCase().replace(/[^a-f0-9]/g, '');
  if (h.length !== 40 && h.length !== 32) return '';
  var mag = 'magnet:?xt=urn:btih:' + h;
  if (title) mag += '&dn=' + encodeURIComponent(String(title).slice(0, 180));
  return mag;
}

function _normalizeQuery(query) {
  return _trim(query)
    .replace(/[\u2018\u2019\u201A\u201B']/g, '')
    .replace(/[\u201C\u201D\u201E\u201F"]/g, '')
    .replace(/\s+/g, ' ');
}

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
  add(base.replace(/,?\s*book\s*\d+\s*$/i, ''));
  add(base.replace(/,?\s*\(book\s*\d+\)\s*$/i, ''));
  add(base.replace(/:\s*.+$/, ''));
  var withAb = [];
  for (var i = 0; i < out.length; i++) {
    if (!/\baudiobook\b/i.test(out[i])) withAb.push(out[i] + ' audiobook');
  }
  return withAb.concat(out);
}

function _shouldDrop(title) {
  var t = String(title || '');
  if (/\bS\d{1,2}\s*E\d{1,2}\b/i.test(t)) return true;
  if (/\b(?:epub|pdf|mobi|azw3?|kf8|cbr|cbz)\b/i.test(t)) return true;
  var audio = _AUDIO_HINT.test(t) || _AUDIO_EXT.test(t);
  if (/\b(?:1080p|720p|2160p|480p|576p)\b/i.test(t) && !audio) return true;
  if (_VIDEO_HINT.test(t) && !audio) return true;
  return false;
}

function _scoreHit(title, seeders, size) {
  var t = String(title || '');
  var seeds = Number(seeders) || 0;
  var score = Math.min(seeds, 80) * 5;
  var audio = _AUDIO_HINT.test(t) || _AUDIO_EXT.test(t);
  var video = _VIDEO_HINT.test(t);
  if (audio) score += 8000;
  if (/\baudiobook\b/i.test(t)) score += 2500;
  if (/\.m4b\b/i.test(t)) score += 3500;
  if (/\.mp3\b/i.test(t) || /\bmp3\b/i.test(t)) score += 2500;
  if (video && !audio) score -= 20000;
  if (_MOBILE_UNPLAYABLE.test(t)) score -= 25000;
  var n = Number(size) || 0;
  if (n >= 5e7 && n <= 3.5e9) score += 120;
  if (n > 5e9 && !audio) score -= 5000;
  return score;
}

function _looksLikeHtml(body) {
  var s = _trim(body).slice(0, 80).toLowerCase();
  return !s || s.charAt(0) === '<' || s.indexOf('<!doctype') === 0 || s.indexOf('<html') === 0;
}

function _parseJsonBody(r, label) {
  var body = r && r.body != null ? String(r.body) : '';
  if (_looksLikeHtml(body)) {
    _log(label, 'got HTML — likely gateway block');
    return null;
  }
  try { return JSON.parse(body); } catch (e) {
    _log(label, 'JSON parse failed', String(e));
    return null;
  }
}

function _mapRows(rows, sourceTag) {
  var scored = [];
  var droppedJunk = 0;
  var skippedHash = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var hash = r.infohash || r.infoHash || r.hash || '';
    var title = r.title || r.name || 'Audiobook';
    if (_shouldDrop(title)) {
      droppedJunk++;
      continue;
    }
    var magnet = _magnetFromHash(hash, title);
    if (!magnet) {
      skippedHash++;
      continue;
    }
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
      source: sourceTag,
      _score: _scoreHit(title, seeds, size)
    });
  }
  scored.sort(function (a, b) { return (b._score || 0) - (a._score || 0); });
  _log(
    'mapRows', sourceTag, 'in=' + rows.length, 'out=' + scored.length,
    'droppedJunk=' + droppedJunk, 'skippedHash=' + skippedHash
  );
  return scored;
}

function _csvSearchOnce(q, limit) {
  var url = _TORRENTS_CSV
    + '?q=' + encodeURIComponent(q)
    + '&size=' + encodeURIComponent(String(limit));
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  }).then(function (r) {
    var j = _parseJsonBody(r, 'torrents-csv');
    var rows = (j && j.torrents) || [];
    if (!Array.isArray(rows)) rows = [];
    return rows;
  }).catch(function () { return []; });
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
    var scored = _mapRows(merged, 'torrentscsv');
    var start = Math.max(0, ((page || 1) - 1) * limit);
    var pageHits = scored.slice(start, start + limit).map(function (hit) {
      delete hit._score;
      return hit;
    });
    _log('finish mergedRaw=' + merged.length, 'mapped=' + scored.length, 'return=' + pageHits.length);
    return pageHits;
  }

  function runDirect(i) {
    if (i >= variants.length) return Promise.resolve(finish());
    var v = variants[i];
    _log('direct CSV variant', i + 1, '/', variants.length, v.slice(0, 80));
    return _csvSearchOnce(v, fetchLimit).then(function (rows) {
      _log('direct CSV rows', rows.length);
      absorb(rows);
      if (merged.length >= limit) return finish();
      return runDirect(i + 1);
    });
  }

  _log('indexSearch variants=' + variants.length, 'limit=' + limit, 'fetchLimit=' + fetchLimit);
  return runDirect(0);
}

function search(query, page) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  _log('search', q.slice(0, 96), 'page', page || 1);
  return _indexSearch(q, page || 1).then(function (hits) {
    _log('search done hits=' + hits.length);
    return hits;
  });
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
  var magnet = _trim(url);
  if (!/^magnet:/i.test(magnet)) return Promise.resolve([]);
  var label = 'Release';
  var m = magnet.match(/[?&]dn=([^&]+)/i);
  if (m) {
    try { label = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { label = m[1]; }
  }
  return Promise.resolve([
    { url: magnet, label: label, container: 'torrent', quality: '' }
  ]);
}

function getVideoSources(url) {
  return getAudioSources(url);
}

exports.getInfo = getInfo;
exports.getSettings = getSettings;
exports.search = search;
exports.getDetail = getDetail;
exports.getAudioSources = getAudioSources;
exports.getVideoSources = getVideoSources;
