/**
 * Golden Audiobooks — WordPress catalogue + ipaudio.club chapter MP3 streams.
 * Search/detail via the public WP REST API; audio URLs are scraped from post HTML.
 */

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'goldenaudiobooks';

var DEFAULT_BASE = 'https://goldenaudiobooks.com';
var SEARCH_PER_PAGE = 24;
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

var _AUDIO_URL = /https?:\/\/[^"'<>\s]+\.(?:mp3|m4b)/gi;

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

function _baseUrl() {
  var custom = _trim(_settings().baseUrl || '');
  return (custom || DEFAULT_BASE).replace(/\/+$/, '');
}

function _fetchHeaders() {
  return {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: _baseUrl() + '/',
  };
}

function _sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function _decodeHtml(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, function (_, n) {
      var code = parseInt(n, 10);
      return isFinite(code) ? String.fromCharCode(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) {
      var code = parseInt(h, 16);
      return isFinite(code) ? String.fromCharCode(code) : _;
    })
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _parseJsonBody(res) {
  if (typeof res.json === 'function') return res.json();
  var raw = res.body != null ? res.body : '';
  if (typeof raw !== 'string') raw = String(raw);
  if (!raw) return null;
  return JSON.parse(raw);
}

function _fetchJson(url, attempt) {
  var tryNum = attempt || 0;
  var max = 5;
  return fetch(url, { headers: _fetchHeaders() }).then(function (res) {
    if (!res.ok) {
      if (tryNum + 1 < max && (res.status === 429 || res.status >= 500)) {
        return _sleep(150 * (tryNum + 1)).then(function () {
          return _fetchJson(url, tryNum + 1);
        });
      }
      throw new Error('HTTP ' + res.status + ' for ' + url);
    }
    return _parseJsonBody(res);
  }).catch(function (err) {
    if (tryNum + 1 < max) {
      return _sleep(200 * (tryNum + 1)).then(function () {
        return _fetchJson(url, tryNum + 1);
      });
    }
    throw err;
  });
}

function _slugFromUrl(url) {
  var s = _trim(url);
  if (!s) return '';
  var m = s.match(/goldenaudiobooks\.com\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1].replace(/\/+$/, ''));
  m = s.match(/^\/([^/?#]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (!/^https?:\/\//i.test(s) && /^[a-z0-9-]+$/i.test(s)) return s;
  return '';
}

function _titleAuthorFromPostTitle(title) {
  var t = _decodeHtml(title).replace(/\s+Audiobook\s*$/i, '').trim();
  var m = t.match(/^(.+?)\s+[–\-]\s+(.+)$/);
  if (m) {
    return { author: _trim(m[1]), title: _trim(m[2]) };
  }
  return { title: t, author: '' };
}

function _coverFromYoast(yoast) {
  if (!yoast || !yoast.og_image || !yoast.og_image.length) return '';
  return _trim(yoast.og_image[0].url || '');
}

function _coverFromEmbedded(post) {
  try {
    var emb = post._embedded || {};
    var media = emb['wp:featuredmedia'];
    if (media && media[0] && media[0].source_url) {
      return _trim(media[0].source_url);
    }
  } catch (e) {}
  return _coverFromYoast(post.yoast_head_json);
}

function _descriptionFromPost(post) {
  var ex = post.excerpt && post.excerpt.rendered;
  if (ex) return _decodeHtml(ex);
  var yoast = post.yoast_head_json;
  if (yoast && yoast.og_description) return _decodeHtml(yoast.og_description);
  return '';
}

function _searchHitFromPost(post) {
  var rawTitle = (post.title && post.title.rendered) || '';
  var parts = _titleAuthorFromPostTitle(rawTitle);
  var link = _trim(post.link || '');
  if (!link || !parts.title) return null;
  return {
    id: String(post.id || link),
    title: parts.title,
    author: parts.author,
    url: link,
    detailUrl: link,
    coverUrl: _coverFromYoast(post.yoast_head_json) || _coverFromEmbedded(post) || undefined,
  };
}

function _coerceSearchQuery(query) {
  if (query == null) return '';
  if (typeof query === 'object') {
    var t = _trim(query.title || query.name || query.query || '');
    var s = _trim(query.subtitle || '');
    var a = _trim(query.author || '');
    if (t && s) return _trim(t + ': ' + s);
    if (t && a) return _trim(a + ' ' + t);
    return t || s || a || '';
  }
  return _trim(String(query));
}

function _normalizeSearchQuery(query) {
  return _coerceSearchQuery(query)
    .replace(/\uFF1A/g, ':')
    .replace(/[\u2018\u2019\u201A\u201B']/g, '')
    .replace(/[\u201C\u201D\u201E\u201F"]/g, '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ');
}

function _pageNum(page) {
  var p = parseInt(page, 10);
  if (!isFinite(p) || p < 1) return 1;
  return p;
}

function _pushSearchTerm(list, term) {
  var t = _trim(term);
  if (!t || t.length < 2) return;
  var lower = t.toLowerCase();
  for (var i = 0; i < list.length; i++) {
    if (list[i].toLowerCase() === lower) return;
  }
  list.push(t);
}

function _searchQueryPlan(query) {
  var q = _normalizeSearchQuery(query);
  var tryTerms = [];
  if (!q) return { tryTerms: tryTerms, pageTerm: '' };
  var beforeColon = _trim(q.replace(/:\s*.+$/, ''));
  var beforeDash = _trim(q.replace(/\s+-\s+.+$/, ''));
  if (beforeColon.length >= 2 && beforeColon.toLowerCase() !== q.toLowerCase()) {
    _pushSearchTerm(tryTerms, beforeColon);
  }
  if (beforeDash.length >= 2 && beforeDash.toLowerCase() !== q.toLowerCase()) {
    _pushSearchTerm(tryTerms, beforeDash);
  }
  _pushSearchTerm(tryTerms, q);
  var pageTerm = beforeColon.length >= 2 ? beforeColon : q;
  if (pageTerm.toLowerCase() === q.toLowerCase() && beforeDash.length >= 2) {
    pageTerm = beforeDash;
  }
  return { tryTerms: tryTerms, pageTerm: pageTerm };
}

function _searchRequestUrl(term, page) {
  return _baseUrl() + '/wp-json/wp/v2/posts?search=' + encodeURIComponent(term) +
    '&per_page=' + SEARCH_PER_PAGE + '&page=' + _pageNum(page) +
    '&_fields=id,link,title,yoast_head_json';
}

function _postsToSearchHits(rows) {
  if (!Array.isArray(rows)) return [];
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var hit = _searchHitFromPost(rows[i]);
    if (hit) out.push(hit);
  }
  return out;
}

function _fetchSearchHits(term, page) {
  return _fetchJson(_searchRequestUrl(term, page)).then(function (rows) {
    return _postsToSearchHits(rows);
  }).catch(function () {
    return [];
  });
}

function _mergeSearchHits(acc, rows) {
  var seen = {};
  var i;
  for (i = 0; i < acc.length; i++) {
    seen[acc[i].id] = true;
  }
  for (i = 0; i < rows.length; i++) {
    if (seen[rows[i].id]) continue;
    seen[rows[i].id] = true;
    acc.push(rows[i]);
  }
  return acc;
}

function _loadPostBySlug(slug) {
  var base = _baseUrl();
  var url = base + '/wp-json/wp/v2/posts?slug=' + encodeURIComponent(slug) +
    '&_embed=wp:featuredmedia';
  return _fetchJson(url).then(function (rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('Post not found: ' + slug);
    }
    return rows[0];
  });
}

function _loadPostByUrl(url) {
  var slug = _slugFromUrl(url);
  if (!slug) return Promise.reject(new Error('Invalid Golden Audiobooks URL'));
  return _loadPostBySlug(slug);
}

function _trackNumberFromUrl(audioUrl) {
  var m = String(audioUrl).match(/\/(\d+)\.(?:mp3|m4b)(?:\?|$)/i);
  if (m) return parseInt(m[1], 10);
  m = String(audioUrl).match(/(\d+)\.(?:mp3|m4b)$/i);
  return m ? parseInt(m[1], 10) : 99999;
}

function _audioUrlsFromHtml(html) {
  var seen = {};
  var out = [];
  var m;
  var re = new RegExp(_AUDIO_URL.source, 'gi');
  while ((m = re.exec(String(html || ''))) !== null) {
    var u = m[0];
    if (seen[u]) continue;
    seen[u] = true;
    out.push(u);
  }
  out.sort(function (a, b) {
    var na = _trackNumberFromUrl(a);
    var nb = _trackNumberFromUrl(b);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });
  return out;
}

function _sourcesFromUrls(urls) {
  return urls.map(function (u, idx) {
    var num = _trackNumberFromUrl(u);
    var label = num < 99999
      ? ('Chapter ' + (num < 10 ? '0' + num : String(num)))
      : ('Track ' + (idx + 1));
    var lower = u.toLowerCase();
    return {
      url: u,
      label: label,
      container: lower.indexOf('.m4b') >= 0 ? 'm4b' : 'mp3',
      quality: '',
    };
  });
}

function getInfo() {
  return {
    name: 'Golden Audiobooks',
    lang: 'en',
    baseUrl: _baseUrl(),
    logo: _baseUrl() + '/wp-content/uploads/2018/08/' +
      'cropped-rsz_1golden-open-book-vector-3716385-1-192x192.jpg',
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

function _searchSequential(terms, acc, idx) {
  if (idx >= terms.length) return Promise.resolve(acc);
  return _fetchSearchHits(terms[idx], 1).then(function (rows) {
    var merged = _mergeSearchHits(acc, rows);
    if (merged.length > 0) return merged;
    return _searchSequential(terms, merged, idx + 1);
  });
}

function search(query, page) {
  var plan = _searchQueryPlan(query);
  if (!plan.tryTerms.length) return Promise.resolve([]);
  var p = _pageNum(page);
  if (p > 1) {
    return _fetchSearchHits(plan.pageTerm, p);
  }
  return _searchSequential(plan.tryTerms, [], 0);
}

function getDetail(url) {
  return _loadPostByUrl(url).then(function (post) {
    var rawTitle = (post.title && post.title.rendered) || '';
    var parts = _titleAuthorFromPostTitle(rawTitle);
    var link = _trim(post.link || url);
    return {
      url: link,
      title: parts.title || _decodeHtml(rawTitle),
      author: parts.author || '',
      description: _descriptionFromPost(post),
      coverUrl: _coverFromEmbedded(post) || undefined,
      asin: null,
    };
  });
}

function getAudioSources(url) {
  return _loadPostByUrl(url).then(function (post) {
    var html = (post.content && post.content.rendered) || '';
    var urls = _audioUrlsFromHtml(html);
    return _sourcesFromUrls(urls);
  }).catch(function () {
    return [];
  });
}

exports.getInfo = getInfo;
exports.getSettings = getSettings;
exports.search = search;
exports.getDetail = getDetail;
exports.getAudioSources = getAudioSources;
