/**
 * Internet Archive (archive.org) — public audio / audiobook items.
 *
 * Search uses the advancedsearch JSON API. Items tagged format:Audiobook
 * typically host .m4b files. Multi-file VBR MP3 uploads are returned as a
 * single derived `{identifier}_vbr.m3u` playlist for the app to expand.
 */

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'internetarchive';

var BASE = 'https://archive.org';
var ROWS = 20;
var _AUDIO_EXT = /\.(m4b|mp3|m4a|flac|ogg|opus|aac|wma)$/i;
var _LUCENE_SPECIAL = /([+\-&|!(){}\[\]^"~*?:\\])/g;

function registerProvider(exports) {}

function _trim(s) {
  return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
}

function _settings() {
  try {
    var bag = (typeof __settings !== 'undefined' && __settings) ? __settings : {};
    return bag[SOURCE_ID] || {};
  } catch (e) {
    return {};
  }
}

function _audiobooksOnly() {
  var s = _settings();
  return s.audiobooksOnly !== false &&
    s.audiobooksOnly !== 'false' &&
    s.audiobooksOnly !== 0;
}

function _preferM4b() {
  var s = _settings();
  return s.preferM4b !== false &&
    s.preferM4b !== 'false' &&
    s.preferM4b !== 0;
}

function _escapeLucene(q) {
  return String(q || '').replace(_LUCENE_SPECIAL, '\\$1');
}

function _creator(doc) {
  var c = doc && doc.creator;
  if (Array.isArray(c)) return _trim(c[0] || '');
  return _trim(c || '');
}

function _formatBytes(n) {
  var bytes = Number(n);
  if (!isFinite(bytes) || bytes <= 0) return '';
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  var digits = i === 0 ? 0 : (bytes >= 100 ? 0 : 1);
  return bytes.toFixed(digits) + ' ' + units[i];
}

function _identifierFromUrl(url) {
  var s = _trim(url);
  if (!s) return '';
  var m = s.match(/\/(?:details|download|metadata)\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]);
  if (/^[A-Za-z0-9._-]+$/.test(s)) return s;
  return '';
}

function _detailsUrl(id) {
  return BASE + '/details/' + encodeURIComponent(id);
}

function _downloadUrl(id, name) {
  return BASE + '/download/' + encodeURIComponent(id) + '/' + encodeURIComponent(name);
}

function _containerForName(name) {
  var lower = String(name || '').toLowerCase();
  if (lower.endsWith('.m4b')) return 'm4b';
  if (lower.endsWith('.mp3')) return 'mp3';
  if (lower.endsWith('.m3u8')) return 'm3u8';
  if (lower.endsWith('.m3u')) return 'm3u';
  return 'unknown';
}

function _isAudioFile(f) {
  if (!f || !f.name) return false;
  if (String(f.name).indexOf('/') !== -1) return false; // skip nested deriv paths
  var name = String(f.name);
  if (_AUDIO_EXT.test(name)) return true;
  var fmt = String(f.format || '').toLowerCase();
  return fmt === 'audiobook' ||
    fmt.indexOf('mp3') !== -1 ||
    fmt.indexOf('mpeg-4 audio') !== -1 ||
    fmt.indexOf('flac') !== -1 ||
    fmt.indexOf('ogg') !== -1 ||
    fmt.indexOf('vorbis') !== -1 ||
    fmt.indexOf('opus') !== -1;
}

function _naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function _rankAudioFile(f) {
  var name = String(f.name || '').toLowerCase();
  var fmt = String(f.format || '').toLowerCase();
  if (name.endsWith('.m4b') || fmt === 'audiobook') return 0;
  if (name.endsWith('.mp3') || fmt.indexOf('mp3') !== -1) return 1;
  if (name.endsWith('.m4a') || fmt.indexOf('mpeg-4') !== -1) return 2;
  return 3;
}

function _fetchJson(url) {
  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    return res.json();
  });
}

function _searchQuery(query) {
  var q = _escapeLucene(_trim(query));
  var parts = ['(' + q + ')', 'mediatype:(audio)'];
  if (_audiobooksOnly()) {
    // IA tags .m4b (and similar single-file audiobooks) as format "Audiobook".
    parts.push('format:("Audiobook")');
  } else {
    parts.push(
      '(format:("Audiobook") OR format:("VBR MP3") OR format:("MP3") OR ' +
        'format:("MPEG-4 Audio") OR format:("Flac") OR format:("Ogg Vorbis"))'
    );
  }
  return parts.join(' AND ');
}

/** IA derives `{identifier}_vbr.m3u` for multi-file VBR MP3 items. */
function _vbrM3uSource(id, fileCount, itemSize) {
  var name = id + '_vbr.m3u';
  var sizeLabel = _formatBytes(itemSize);
  return {
    url: _downloadUrl(id, name),
    label: sizeLabel
      ? 'VBR playlist (' + fileCount + ' files, ' + sizeLabel + ')'
      : 'VBR playlist (' + fileCount + ' files)',
    container: 'm3u',
    quality: 'VBR M3U',
  };
}

function _sourceFromFile(id, f) {
  var name = f.name;
  var sizeLabel = _formatBytes(f.size);
  return {
    url: _downloadUrl(id, name),
    label: sizeLabel ? name + ' (' + sizeLabel + ')' : name,
    container: _containerForName(name),
    quality: f.format || sizeLabel || undefined,
  };
}

exports.getInfo = function () {
  return {
    name: 'Internet Archive',
    lang: 'en',
    baseUrl: BASE,
    logo: BASE + '/images/glogo.png',
    type: 'audiobook',
    version: '1.1.0',
  };
};

exports.getSettings = function () {
  return [
    {
      key: 'audiobooksOnly',
      label: 'Audiobook format only (.m4b / format:Audiobook)',
      type: 'bool',
      default: true,
    },
    {
      key: 'preferM4b',
      label: 'Prefer .m4b when available',
      type: 'bool',
      default: true,
    },
  ];
};

exports.search = async function (query, page) {
  if (!_trim(query)) return [];
  var p = page || 1;
  var url =
    BASE +
    '/advancedsearch.php?q=' +
    encodeURIComponent(_searchQuery(query)) +
    '&fl[]=identifier,title,creator,format,item_size' +
    '&rows=' +
    ROWS +
    '&page=' +
    p +
    '&output=json';
  var json = await _fetchJson(url);
  var docs = (json.response && json.response.docs) || [];
  return docs.map(function (doc) {
    var id = doc.identifier;
    var sizeLabel = _formatBytes(doc.item_size);
    return {
      id: id,
      title: doc.title || id,
      author: _creator(doc),
      url: _detailsUrl(id),
      detailUrl: _detailsUrl(id),
      sizeLabel: sizeLabel || undefined,
      coverUrl: BASE + '/services/img/' + encodeURIComponent(id),
    };
  });
};

exports.getDetail = async function (url) {
  var id = _identifierFromUrl(url);
  if (!id) throw new Error('Invalid Internet Archive URL');
  var json = await _fetchJson(BASE + '/metadata/' + encodeURIComponent(id));
  var meta = json.metadata || {};
  return {
    url: _detailsUrl(id),
    title: meta.title || id,
    author: Array.isArray(meta.creator)
      ? _trim(meta.creator[0] || '')
      : _trim(meta.creator || ''),
    description: _trim(meta.description || ''),
    coverUrl: BASE + '/services/img/' + encodeURIComponent(id),
    asin: null,
  };
};

exports.getAudioSources = async function (url) {
  var id = _identifierFromUrl(url);
  if (!id) return [];
  var json = await _fetchJson(BASE + '/metadata/' + encodeURIComponent(id));
  var files = (json.files || []).filter(_isAudioFile);
  if (files.length === 0) return [];

  files.sort(function (a, b) {
    var ra = _rankAudioFile(a);
    var rb = _rankAudioFile(b);
    if (ra !== rb) return ra - rb;
    return _naturalCompare(a.name || '', b.name || '');
  });

  var m4bs = files.filter(function (f) {
    return String(f.name || '').toLowerCase().endsWith('.m4b') ||
      String(f.format || '').toLowerCase() === 'audiobook';
  });

  if (_preferM4b() && m4bs.length > 0) {
    // One hit per book: prefer a single .m4b when present.
    return [_sourceFromFile(id, m4bs[0])];
  }

  if (files.length > 1) {
    // Multi-file items expose a derived VBR M3U on archive.org; SoundLoom
    // expands that playlist into chapter tracks after unlock.
    var itemSize = 0;
    for (var i = 0; i < files.length; i++) {
      itemSize += Number(files[i].size || 0) || 0;
    }
    return [_vbrM3uSource(id, files.length, itemSize)];
  }

  return [_sourceFromFile(id, files[0])];
};
