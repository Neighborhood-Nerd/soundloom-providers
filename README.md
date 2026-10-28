# soundloom-providers

Hydra / Zangetsu-style provider repo for [SoundLoom](../soundloom).

## Install in the app

1. Settings → Sources → Add repo
2. Paste this manifest URL (after publishing):

```
https://raw.githubusercontent.com/Neighborhood-Nerd/soundloom-providers/refs/heads/master/index.json
```

3. Tap **Install** next to a source.

## Provider contract

Providers follow the same **Zangetsu-style** JS contract: top-level functions
(not a required `exports` object). SoundLoom registers whichever of these exist:

| Method | Role |
|--------|------|
| `getInfo()` | name, lang, baseUrl, type, version, logo |
| `getSettings()` | optional settings schema (`apiKey`, enums, …) |
| `search(query, page)` | search hits |
| `getHome(opts)` | optional home rows |
| `getDetail(url)` | title detail |
| `getEpisodes(url)` | optional episode list |
| `getVideoSources(url)` / `getAudioSources(url)` | playable sources |

Audiobook sources (e.g. LibriVox) may still assign methods on `exports` for
compatibility. Optional: set `asin` on detail/search hits for catalogue matching.

See `providers/torbox.js` for an audiobook TorBox debrid example
(`search` → magnet hits, `getAudioSources` → TorBox unlock).

`providers/internetarchive.js` searches [archive.org](https://archive.org)
audio items (default: `format:Audiobook`, which surfaces `.m4b` titles).
Single-file items return a direct `.m4b`/audio URL; multi-file items return one
derived `{identifier}_vbr.m3u` playlist (SoundLoom expands it into chapter
tracks).

Optional local dev server (static files only — same as GitHub, with CORS):

```bash
python3 serve.py
# repo URL: http://<lan-ip>:8000/index.json
```

Torrent providers call their public APIs directly from the app (`torrentscsv.js`,
`solidtorrents.js`, etc.). There is no server-side search in this repo.

### Audiobookshelf (`audiobookshelf.js`)

Self-hosted [Audiobookshelf](https://www.audiobookshelf.org/) server as a source:

1. Install the source under **Settings → Sources**
2. Open source settings and set **Server URL** (e.g. `https://abs.example.com`) and **API token** (ABS web app → Config → Users → your account)
3. Optionally set a **Library ID** to search one library; leave empty to search all book libraries you can access

Search returns books from your server; playback and downloads use authenticated file URLs (`?token=`). Listening progress is tracked in the app only (not synced to ABS).

## Contract tests

```bash
cd js_harness && npm test
```
