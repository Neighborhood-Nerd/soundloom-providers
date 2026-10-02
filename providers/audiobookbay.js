// AudioBook Bay — search + detail scrape (ported from audio_book_bay 0.0.4 Dart package).
// Returns detail URLs from search; getAudioSources builds a magnet from the Info Hash row.
// Pair with TorBox (or another debrid) for playback — magnets are unlocked in the app.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'audiobookbay';

var DEFAULT_BASE = 'https://audiobookbay.lu';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function registerProvider(exports) {}

function _trim(s) {
  return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
}

function _settings() {
  try {
    var bag = (typeof __settings !== 'undefined' && __settings) ? __settings : {};
    return bag[SOURCE_ID] || {};
  } catch (e) { return {}; }
}

function _baseUrl() {
  var custom = _trim(_settings().baseUrl || '');
  return (custom || DEFAULT_BASE).replace(/\/+$/, '');
}

function _absUrl(pathOrUrl) {
  var s = _trim(pathOrUrl);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return _baseUrl() + (s.charAt(0) === '/' ? s : '/' + s);
}

function _decodeHtml(s) {
  return String(s || '')
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function _fetchHeaders() {
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: _baseUrl() + '/',
    Connection: 'close',
  };
}

function _fetchText(url, attempt) {
  var tryNum = attempt || 0;
  var max = 5;
  return fetch(url, { headers: _fetchHeaders() }).then(function (res) {
    if (!res.ok) {
      if (tryNum + 1 < max && (res.status === 429 || res.status >= 500)) {
        return _sleep(150 * (tryNum + 1)).then(function () {
          return _fetchText(url, tryNum + 1);
        });
      }
      throw new Error('HTTP ' + res.status + ' for ' + url);
    }
    return res.text();
  }).catch(function (err) {
    if (tryNum + 1 < max) {
      return _sleep(200 * (tryNum + 1)).then(function () {
        return _fetchText(url, tryNum + 1);
      });
    }
    throw err;
  });
}

function _searchUrl(query, page) {
  var base = _baseUrl();
  var p = page || 1;
  var q = _trim(query);
  if (p > 1) {
    return base + '/page/' + p + (q ? '/?s=' + encodeURIComponent(q) : '/');
  }
  return q ? base + '/?s=' + encodeURIComponent(q) : base + '/';
}

function _noResults(html) {
  return /<div[^>]+id="content"[^>]*>[\s\S]*?<h3>\s*Not Found\s*<\/h3>/i.test(html);
}

function _titleAuthorFromPostTitle(title) {
  var t = _decodeHtml(title);
  var m = t.match(/^(.+?)\s+-\s+(.+)$/);
  if (!m) return { title: t, author: '' };
  if (m[1].length >= m[2].length) return { title: m[1], author: m[2] };
  return { title: m[2], author: m[1] };
}

function _linkFromPostBlock(block) {
  var m = block.match(
    /<div class="postTitle"[\s\S]*?<h2>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
  );
  if (m) {
    return { href: m[1], title: m[2] };
  }
  try {
    var b64 = block.match(/<div class="post"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
    if (b64 && b64[1]) {
      var decoded = atob(b64[1].replace(/<[^>]+>/g, '').trim());
      var inner = decoded.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (inner) return { href: inner[1], title: inner[2] };
    }
  } catch (e) {}
  return null;
}

function _coverFromPost(block) {
  var m = block.match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : '';
}

function _parseSearchPosts(html) {
  var parts = html.split('<div class="post">');
  var out = [];
  for (var i = 1; i < parts.length; i++) {
    var block = parts[i];
    var link = _linkFromPostBlock('<div class="post">' + block);
    if (!link) continue;
    var detailUrl = _absUrl(link.href);
    var meta = _titleAuthorFromPostTitle(link.title);
    if (!meta.title || !detailUrl) continue;
    out.push({
      id: detailUrl,
      title: meta.title,
      author: meta.author,
      url: detailUrl,
      detailUrl: detailUrl,
      coverUrl: _coverFromPost(block),
    });
  }
  return out;
}

function _magnetFromHash(hash, title) {
  var h = String(hash || '').toLowerCase().replace(/[^a-f0-9]/g, '');
  if (h.length !== 40 && h.length !== 32) return '';
  var mag = 'magnet:?xt=urn:btih:' + h;
  if (title) mag += '&dn=' + encodeURIComponent(String(title).slice(0, 180));
  return mag;
}

function _infoHashFromDetailHtml(html) {
  var m = html.match(/Info Hash:<\/td>\s*<td[^>]*>([a-fA-F0-9]{32,40})/i);
  if (m) return m[1];
  m = html.match(/btih:([a-fA-F0-9]{32,40})/i);
  return m ? m[1] : '';
}

function _detailTitle(html) {
  var m = html.match(/<div class="postTitle"[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (m) return _decodeHtml(m[1]);
  m = html.match(/<div class="postTitle"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (m) return _decodeHtml(m[1]);
  m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? _decodeHtml(m[1]).replace(/\s*Audiobook.*$/i, '') : 'Audiobook';
}

function _normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '');
}

function _scoreTitleMatch(query, title, author) {
  var q = _normalizeForMatch(query);
  var t = _normalizeForMatch(title);
  var a = _normalizeForMatch(author || '');
  if (a) t = t + ' ' + a;
  if (!q || !t) return 0;
  if (t === q) return 100000;
  if (t.indexOf(q) === 0) return 90000 - Math.min(t.length - q.length, 5000);
  var idx = t.indexOf(q);
  if (idx >= 0) return 80000 - Math.min(idx, 5000);

  var parts = q.split(' ').filter(function (w) { return w.length > 1; });
  if (!parts.length) return 0;

  var inOrder = 0;
  var from = 0;
  for (var i = 0; i < parts.length; i++) {
    var at = t.indexOf(parts[i], from);
    if (at < 0) break;
    inOrder++;
    from = at + parts[i].length;
  }
  var matched = 0;
  for (var j = 0; j < parts.length; j++) {
    if (t.indexOf(parts[j]) >= 0) matched++;
  }
  return inOrder * 2000 + Math.round((matched / parts.length) * 1500);
}

function _sortByRelevance(query, rows) {
  return rows.sort(function (a, b) {
    var sa = _scoreTitleMatch(query, a.title, a.author);
    var sb = _scoreTitleMatch(query, b.title, b.author);
    return sb - sa;
  });
}

function _legacyDownloadPath(html) {
  var m = html.match(/<a[^>]+href="([^"]*dload-now[^"]*)"/i);
  if (m) return _absUrl(m[1]);
  m = html.match(/<a[^>]+href="([^"]*downld[^"]*)"/i);
  return m ? _absUrl(m[1]) : '';
}

function getInfo() {
  return {
    name: 'AudioBook Bay',
    lang: 'en',
    baseUrl: _baseUrl(),
    type: 'audiobook',
    version: '1.0.2',
  };
}

function getSettings() {
  return [
    {
      key: 'baseUrl',
      label: 'Site base URL (mirror)',
      type: 'text',
      default: DEFAULT_BASE,
    },
  ];
}

function search(query, page) {
  if (!_trim(query)) return Promise.resolve([]);
  var url = _searchUrl(query, page || 1);
  return _fetchText(url).then(function (html) {
    if (_noResults(html)) return [];
    return _sortByRelevance(query, _parseSearchPosts(html));
  });
}

function getDetail(url) {
  var abs = _absUrl(url);
  if (/^magnet:/i.test(abs)) {
    var title = 'Audiobook';
    var dn = abs.match(/[?&]dn=([^&]+)/i);
    if (dn) {
      try { title = decodeURIComponent(dn[1].replace(/\+/g, ' ')); } catch (e) { title = dn[1]; }
    }
    var parts = _titleAuthorFromPostTitle(title);
    return Promise.resolve({
      url: abs,
      title: parts.title || title,
      author: parts.author || '',
      asin: null,
    });
  }
  return _fetchText(abs).then(function (html) {
    var titleRaw = _detailTitle(html);
    var parts = _titleAuthorFromPostTitle(titleRaw);
    return {
      url: abs,
      title: parts.title || titleRaw,
      author: parts.author || '',
      asin: null,
    };
  });
}

function getAudioSources(url) {
  var abs = _absUrl(url);
  if (/^magnet:/i.test(abs)) {
    return Promise.resolve([
      { url: abs, label: 'Magnet', container: 'torrent', quality: '' },
    ]);
  }
  return _fetchText(abs).then(function (html) {
    var title = _detailTitle(html);
    var hash = _infoHashFromDetailHtml(html);
    var magnet = _magnetFromHash(hash, title);
    if (magnet) {
      return [
        { url: magnet, label: title, container: 'torrent', quality: '' },
      ];
    }
    var legacy = _legacyDownloadPath(html);
    if (legacy) {
      return [
        { url: legacy, label: title, container: 'torrent', quality: '' },
      ];
    }
    return [];
  }).catch(function () {
    return [];
  });
}

exports.getInfo = getInfo;
exports.getSettings = getSettings;
exports.search = search;
exports.getDetail = getDetail;
exports.getAudioSources = getAudioSources;
