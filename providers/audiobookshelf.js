/**
 * Audiobookshelf — self-hosted library search + direct file streaming.
 * Configure server URL and API token (ABS Settings → Users → your account).
 * Progress is tracked in the app only; no sync back to ABS.
 */

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'audiobookshelf';

var DEFAULT_BASE = 'https://audiobookshelf.org';
var SEARCH_LIMIT = 24;
var UA = 'SoundLoom/1.0 Audiobookshelf-Provider';

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

function _serverUrl() {
  var custom = _trim(_settings().serverUrl || '');
  return (custom || DEFAULT_BASE).replace(/\/+$/, '');
}

function _apiToken() {
  return _trim(_settings().apiToken || '');
}

function _libraryIdFilter() {
  return _trim(_settings().libraryId || '');
}

function _preferM4b() {
  var s = _settings();
  return s.preferM4b !== false &&
    s.preferM4b !== 'false' &&
    s.preferM4b !== 0;
}

function _requireConfig() {
  var base = _serverUrl();
  var token = _apiToken();
  if (!token) {
    throw new Error('Audiobookshelf API token is required (Source settings)');
  }
  if (!/^https?:\/\//i.test(base)) {
    throw new Error('Audiobookshelf server URL must start with http:// or https://');
  }
  return { base: base, token: token };
}

function _authHeaders() {
  var cfg = _requireConfig();
  return {
    'User-Agent': UA,
    Accept: 'application/json',
    Authorization: 'Bearer ' + cfg.token,
  };
}

function _fetchJson(path) {
  var cfg = _requireConfig();
  var url = path.indexOf('http') === 0 ? path : cfg.base + path;
  return fetch(url, { headers: _authHeaders() }).then(function (res) {
    if (!res.ok) {
      throw new Error('HTTP ' + res.status + ' for ' + url);
    }
    // Host fetch shim exposes body as a string; .text is a function (not the body).
    return res.json();
  });
}

function _itemDetailUrl(itemId) {
  return _serverUrl() + '/item/' + encodeURIComponent(itemId);
}

function _itemIdFromUrl(url) {
  var s = _trim(url);
  if (!s) return '';
  // ABS 2.3+ uses UUID item ids; older servers used li_… prefixes.
  var m = s.match(/\/item\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]);
  m = s.match(/\/api\/items\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]);
  if (/^li_[a-zA-Z0-9]+$/i.test(s)) return s;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return s;
  }
  return '';
}

function _authorName(meta) {
  if (!meta) return '';
  if (_trim(meta.authorName)) return _trim(meta.authorName);
  var authors = meta.authors;
  if (Array.isArray(authors) && authors.length) {
    return _trim(authors[0].name || authors[0]);
  }
  return '';
}

function _asinFromMeta(meta) {
  if (!meta) return null;
  var a = _trim(meta.asin || '');
  return a || null;
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

function _coverUrl(itemId) {
  var cfg = _requireConfig();
  return cfg.base + '/api/items/' + encodeURIComponent(itemId) + '/cover?token=' +
    encodeURIComponent(cfg.token);
}

function _hitFromLibraryItem(item) {
  if (!item || !item.id) return null;
  if (item.mediaType && item.mediaType !== 'book') return null;
  if (item.isMissing || item.isInvalid) return null;
  var meta = (item.media && item.media.metadata) || {};
  var title = _trim(meta.title || item.title || item.id);
  if (!title) return null;
  var size = (item.media && item.media.size) || item.size;
  return {
    id: item.id,
    title: title,
    author: _authorName(meta),
    url: _itemDetailUrl(item.id),
    detailUrl: _itemDetailUrl(item.id),
    asin: _asinFromMeta(meta),
    sizeLabel: size ? _formatBytes(size) : undefined,
    coverUrl: _coverUrl(item.id),
  };
}

function _bookLibraries() {
  return _fetchJson('/api/libraries').then(function (json) {
    var libs = json.libraries || [];
    var filter = _libraryIdFilter();
    var out = [];
    for (var i = 0; i < libs.length; i++) {
      var lib = libs[i];
      if (lib.mediaType !== 'book') continue;
      if (filter && lib.id !== filter) continue;
      out.push(lib);
    }
    if (filter && out.length === 0) {
      throw new Error('Library id not found or not accessible: ' + filter);
    }
    return out;
  });
}

function _searchLibrary(libId, query) {
  var q = encodeURIComponent(query);
  var path = '/api/libraries/' + encodeURIComponent(libId) +
    '/search?q=' + q + '&limit=' + SEARCH_LIMIT;
  return _fetchJson(path).then(function (json) {
    var books = json.book || [];
    var hits = [];
    for (var i = 0; i < books.length; i++) {
      var entry = books[i];
      var item = entry.libraryItem || entry;
      var hit = _hitFromLibraryItem(item);
      if (hit) hits.push(hit);
    }
    return hits;
  });
}

function _searchAllLibraries(query) {
  return _bookLibraries().then(function (libs) {
    if (libs.length === 0) return [];
    var chain = Promise.resolve([]);
    for (var i = 0; i < libs.length; i++) {
      (function (libId) {
        chain = chain.then(function (acc) {
          return _searchLibrary(libId, query).then(function (hits) {
            return acc.concat(hits);
          }).catch(function () {
            return acc;
          });
        });
      })(libs[i].id);
    }
    return chain.then(function (all) {
      var seen = {};
      var deduped = [];
      for (var j = 0; j < all.length; j++) {
        var h = all[j];
        if (seen[h.id]) continue;
        seen[h.id] = true;
        deduped.push(h);
      }
      return deduped;
    });
  });
}

function _loadItem(itemId) {
  return _fetchJson(
    '/api/items/' + encodeURIComponent(itemId) + '?expanded=1'
  );
}

function _containerForFile(f) {
  var name = '';
  if (f.metadata && f.metadata.filename) name = f.metadata.filename;
  else if (f.metadata && f.metadata.ext) name = 'x' + f.metadata.ext;
  var lower = String(name).toLowerCase();
  if (lower.endsWith('.m4b')) return 'm4b';
  if (lower.endsWith('.mp3')) return 'mp3';
  if (lower.endsWith('.m4a')) return 'mp3';
  if (lower.endsWith('.flac')) return 'mp3';
  if (lower.endsWith('.opus') || lower.endsWith('.ogg')) return 'mp3';
  var ext = f.metadata && f.metadata.ext ? String(f.metadata.ext).toLowerCase() : '';
  if (ext === '.m4b') return 'm4b';
  if (ext === '.mp3' || ext === '.m4a') return 'mp3';
  return 'unknown';
}

function _fileLabel(f, index) {
  if (f.metadata && f.metadata.filename) {
    return _trim(f.metadata.filename);
  }
  if (f.metadata && f.metadata.relPath) {
    return _trim(f.metadata.relPath);
  }
  return 'Track ' + (index + 1);
}

function _fileIno(f) {
  if (f.ino != null && f.ino !== '') return String(f.ino);
  var content = _trim(f.contentUrl || '');
  if (content) {
    var m = content.match(/\/file\/([^/?#]+)/i);
    if (m) return m[1];
  }
  return '';
}

function _urlWithToken(url) {
  var cfg = _requireConfig();
  var u = _trim(url);
  if (!u) return u;
  if (u.indexOf('token=') !== -1) return u;
  var sep = u.indexOf('?') === -1 ? '?' : '&';
  return u + sep + 'token=' + encodeURIComponent(cfg.token);
}

function _streamUrl(itemId, ino, contentUrl) {
  var content = _trim(contentUrl || '');
  if (content) {
    if (/^https?:\/\//i.test(content)) return _urlWithToken(content);
    if (content.charAt(0) === '/') {
      return _urlWithToken(_requireConfig().base + content);
    }
  }
  var cfg = _requireConfig();
  // Stream path (not /download) — better for progressive HTTP playback; ?token=
  // keeps Dio downloads working without AudioSource.headers.
  return cfg.base + '/api/items/' + encodeURIComponent(itemId) +
    '/file/' + encodeURIComponent(ino) + '?token=' +
    encodeURIComponent(cfg.token);
}

function _audioFilesFromItem(item) {
  var media = item && item.media;
  if (!media) return [];
  var files = media.audioFiles || media.tracks || [];
  if (!Array.isArray(files)) return [];
  var out = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (f.exclude || f.invalid) continue;
    if (!_fileIno(f) && !_trim(f.contentUrl || '')) continue;
    out.push(f);
  }
  out.sort(function (a, b) {
    var ia = Number(a.index);
    var ib = Number(b.index);
    if (!isNaN(ia) && !isNaN(ib) && ia !== ib) return ia - ib;
    return _fileLabel(a, 0).localeCompare(_fileLabel(b, 0));
  });
  return out;
}

function _sourcesFromItem(item) {
  var itemId = item.id;
  var files = _audioFilesFromItem(item);
  if (files.length === 0) return [];

  var m4bs = files.filter(function (f) {
    return _containerForFile(f) === 'm4b';
  });

  var pick = files;
  if (_preferM4b() && m4bs.length === 1) {
    pick = m4bs;
  } else if (_preferM4b() && m4bs.length > 1) {
    pick = m4bs;
  }

  return pick.map(function (f, idx) {
    var ino = _fileIno(f);
    var meta = f.metadata || {};
    var size = Number(meta.size || f.size || 0) || undefined;
    var cfg = _requireConfig();
    return {
      url: _streamUrl(itemId, ino, f.contentUrl),
      label: _fileLabel(f, idx),
      container: _containerForFile(f),
      quality: '',
      sizeBytes: size > 0 ? size : undefined,
      headers: {
        Authorization: 'Bearer ' + cfg.token,
      },
    };
  });
}

function getInfo() {
  var base = _serverUrl();
  return {
    name: 'Audiobookshelf',
    lang: 'en',
    baseUrl: base,
    logo: base + '/images/icon.svg',
    type: 'audiobook',
    version: '1.0.3',
  };
}

function getSettings() {
  return [
    {
      key: 'serverUrl',
      label: 'Server URL',
      type: 'text',
      default: '',
    },
    {
      key: 'apiToken',
      label: 'API token',
      type: 'text',
      default: '',
    },
    {
      key: 'libraryId',
      label: 'Library ID (optional; search all book libraries when empty)',
      type: 'text',
      default: '',
    },
    {
      key: 'preferM4b',
      label: 'Prefer .m4b when available',
      type: 'bool',
      default: true,
    },
  ];
}

function search(query, page) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  var p = page || 1;
  if (p > 1) {
    return Promise.resolve([]);
  }
  try {
    _requireConfig();
  } catch (e) {
    return Promise.reject(e);
  }
  return _searchAllLibraries(q);
}

function getDetail(url) {
  var itemId = _itemIdFromUrl(url);
  if (!itemId) {
    return Promise.reject(new Error('Invalid Audiobookshelf item URL'));
  }
  return _loadItem(itemId).then(function (item) {
    var meta = (item.media && item.media.metadata) || {};
    return {
      url: _itemDetailUrl(itemId),
      title: _trim(meta.title || itemId),
      author: _authorName(meta),
      description: _trim(meta.description || ''),
      coverUrl: _coverUrl(itemId),
      asin: _asinFromMeta(meta),
    };
  });
}

function getAudioSources(url) {
  var itemId = _itemIdFromUrl(url);
  if (!itemId) return Promise.resolve([]);
  try {
    _requireConfig();
  } catch (e) {
    return Promise.reject(e);
  }
  return _loadItem(itemId).then(function (item) {
    return _sourcesFromItem(item);
  });
}
