/**
 * SoundLoom provider template (Zangetsu-style top-level functions).
 * You may also assign methods on `exports` for compatibility.
 */

function getInfo() {
  return {
    name: 'Example Source',
    lang: 'en',
    baseUrl: 'https://example.com',
    type: 'audiobook',
    version: '1.0.0',
  };
}

function getSettings() {
  return [];
}

function search(query, page) {
  return Promise.resolve([]);
}

function getDetail(url) {
  return Promise.resolve({ url: url, title: 'Example', asin: null });
}

function getAudioSources(url) {
  return Promise.resolve([]);
}
