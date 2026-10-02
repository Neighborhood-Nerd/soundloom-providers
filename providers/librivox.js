/**
 * LibriVox public-domain audiobooks via Internet Archive search.
 */
function registerProvider(exports) {
  // loaded by SoundLoom bootstrap
}

exports.getInfo = function () {
  return {
    name: 'LibriVox',
    lang: 'en',
    baseUrl: 'https://librivox.org',
    type: 'audiobook',
    version: '1.0.1',
  };
};

exports.getSettings = function () {
  return [];
};

exports.search = async function (query, page) {
  if (!query || !String(query).trim()) return [];
  const q = encodeURIComponent('librivox ' + query);
  const url =
    'https://archive.org/advancedsearch.php?q=' +
    q +
    '&fl[]=identifier,title,creator&rows=15&page=' +
    (page || 1) +
    '&output=json';
  const res = await fetch(url);
  const json = await res.json();
  const docs = (json.response && json.response.docs) || [];
  return docs.map(function (doc) {
    const id = doc.identifier;
    return {
      id: id,
      title: doc.title || id,
      author: (doc.creator && doc.creator[0]) || '',
      url: 'https://archive.org/details/' + id,
      detailUrl: 'https://archive.org/details/' + id,
    };
  });
};

exports.getDetail = async function (url) {
  const id = url.split('/details/').pop().split('?')[0];
  const metaUrl =
    'https://archive.org/metadata/' + encodeURIComponent(id);
  const res = await fetch(metaUrl);
  const json = await res.json();
  const meta = json.metadata || {};
  return {
    url: url,
    title: meta.title || id,
    author: meta.creator || '',
    asin: null,
  };
};

exports.getAudioSources = async function (url) {
  const id = url.split('/details/').pop().split('?')[0];
  const metaUrl =
    'https://archive.org/metadata/' + encodeURIComponent(id);
  const res = await fetch(metaUrl);
  const json = await res.json();
  const files = json.files || [];
  const mp3s = files.filter(function (f) {
    return f.format === 'VBR MP3' || (f.name && f.name.endsWith('.mp3'));
  });
  if (mp3s.length === 0) {
    const any = files.find(function (f) {
      return f.name && (f.name.endsWith('.mp3') || f.name.endsWith('.m4b'));
    });
    if (!any) return [];
    return [
      {
        url: 'https://archive.org/download/' + id + '/' + encodeURIComponent(any.name),
        label: any.name,
        container: any.name.endsWith('.m4b') ? 'm4b' : 'mp3',
        quality: '128k',
      },
    ];
  }
  return mp3s.slice(0, 5).map(function (f) {
    return {
      url:
        'https://archive.org/download/' +
        id +
        '/' +
        encodeURIComponent(f.name),
      label: f.name,
      container: 'mp3',
      quality: 'VBR',
    };
  });
};
