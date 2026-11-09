/**
 * LibriVox public-domain audiobooks via Internet Archive search.
 *
 * Cover art matches what librivox.org shows for the item: the IA JPEG
 * (e.g. …/download/{id}/Moby_Dick_1002.jpg), with services/img as fallback.
 */
function registerProvider(exports) {
  // loaded by Cirrus bootstrap
}

var IA = 'https://archive.org';

function _trim(s) {
  return (s == null ? '' : String(s)).replace(/^\s+|\s+$/g, '');
}

function _identifierFromUrl(url) {
  var s = _trim(url);
  if (!s) return '';
  var m = s.match(/\/details\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]);
  // Bare IA identifier
  if (/^[A-Za-z0-9._-]+$/.test(s)) return s;
  return '';
}

function _creator(docOrMeta) {
  var c = docOrMeta && docOrMeta.creator;
  if (Array.isArray(c)) return _trim(c[0] || '');
  return _trim(c || '');
}

/** Same JPEG Librivox embeds on the book page when present on the IA item. */
function _coverFromFiles(id, files) {
  var best = null;
  var bestSize = -1;
  for (var i = 0; i < (files || []).length; i++) {
    var f = files[i];
    var name = _trim(f.name).toLowerCase();
    var format = _trim(f.format).toLowerCase();
    if (!name) continue;
    if (format.indexOf('spectrogram') >= 0) continue;
    if (format === 'item tile' || name === '__ia_thumb.jpg') continue;
    if (format === 'jpeg thumb' || name.indexOf('_thumb.') >= 0) continue;
    // Chapter waveform PNGs look like "chapter.mp3.png"
    if (/\.mp3\.png$/i.test(name) || /\.m4b\.png$/i.test(name)) continue;

    var isJpeg =
      format === 'jpeg' ||
      format === 'jpg' ||
      /\.jpe?g$/i.test(name);
    var isPng = format === 'png' || /\.png$/i.test(name);
    if (!isJpeg && !isPng) continue;

    var size = parseInt(f.size, 10) || 0;
    // Prefer JPEG cover scans over small PNGs
    var score = size + (isJpeg ? 1e9 : 0);
    if (score > bestSize) {
      bestSize = score;
      best = f.name;
    }
  }
  if (best) {
    return (
      IA +
      '/download/' +
      encodeURIComponent(id) +
      '/' +
      encodeURIComponent(best)
    );
  }
  return null;
}

function _coverUrl(id, files) {
  return (
    _coverFromFiles(id, files) ||
    IA + '/services/img/' + encodeURIComponent(id)
  );
}

exports.getInfo = function () {
  return {
    name: 'LibriVox',
    lang: 'en',
    baseUrl: 'https://librivox.org',
    type: 'audiobook',
    version: '1.0.2',
  };
};

exports.getSettings = function () {
  return [];
};

exports.search = async function (query, page) {
  if (!query || !String(query).trim()) return [];
  var q = encodeURIComponent('librivox ' + query);
  var url =
    IA +
    '/advancedsearch.php?q=' +
    q +
    '&fl[]=identifier,title,creator&rows=15&page=' +
    (page || 1) +
    '&output=json';
  var res = await fetch(url);
  var json = await res.json();
  var docs = (json.response && json.response.docs) || [];
  return docs.map(function (doc) {
    var id = doc.identifier;
    return {
      id: id,
      title: doc.title || id,
      author: _creator(doc),
      url: IA + '/details/' + id,
      detailUrl: IA + '/details/' + id,
      // Preview thumb until getDetail resolves the full Librivox JPEG.
      coverUrl: IA + '/services/img/' + encodeURIComponent(id),
    };
  });
};

exports.getDetail = async function (url) {
  var id = _identifierFromUrl(url);
  if (!id) throw new Error('Invalid LibriVox / Internet Archive URL');
  var metaUrl = IA + '/metadata/' + encodeURIComponent(id);
  var res = await fetch(metaUrl);
  var json = await res.json();
  var meta = json.metadata || {};
  return {
    url: IA + '/details/' + id,
    title: meta.title || id,
    author: _creator(meta),
    description: _trim(meta.description || ''),
    coverUrl: _coverUrl(id, json.files || []),
    asin: null,
  };
};

exports.getAudioSources = async function (url) {
  var id = _identifierFromUrl(url);
  if (!id) return [];
  var metaUrl = IA + '/metadata/' + encodeURIComponent(id);
  var res = await fetch(metaUrl);
  var json = await res.json();
  var files = json.files || [];
  var mp3s = files.filter(function (f) {
    return f.format === 'VBR MP3' || (f.name && f.name.endsWith('.mp3'));
  });
  if (mp3s.length === 0) {
    var any = files.find(function (f) {
      return f.name && (f.name.endsWith('.mp3') || f.name.endsWith('.m4b'));
    });
    if (!any) return [];
    return [
      {
        url:
          IA +
          '/download/' +
          id +
          '/' +
          encodeURIComponent(any.name),
        label: any.name,
        container: any.name.endsWith('.m4b') ? 'm4b' : 'mp3',
        quality: '128k',
      },
    ];
  }
  return mp3s.slice(0, 5).map(function (f) {
    return {
      url:
        IA +
        '/download/' +
        id +
        '/' +
        encodeURIComponent(f.name),
      label: f.name,
      container: 'mp3',
      quality: 'VBR',
    };
  });
};
