#!/usr/bin/env python3
"""Static file server + torrent search proxy for SoundLoom providers.

UniFi / gateway SSL inspection often replaces torrents-csv / SolidTorrents
responses with an HTML block page on phones. This proxy runs on your LAN
(mac/PC) and fetches those indexes server-side so the app can search.

Usage (from this repo root):
  python3 serve.py
  # then add repo: http://<lan-ip>:8000/index.json
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8000
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)


def _fetch_json(url: str) -> dict | list | None:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read()
        ctype = (res.headers.get("Content-Type") or "").lower()
        text = raw.decode("utf-8", errors="replace")
        if "<html" in text[:200].lower() or text.lstrip().startswith("<"):
            raise RuntimeError(f"HTML instead of JSON from {url} ({ctype})")
        return json.loads(text)


def _normalize(q: str) -> str:
    q = q.replace("\u2018", "'").replace("\u2019", "'")
    q = q.replace("'", "").replace('"', "")
    return " ".join(q.split())


def _variants(query: str) -> list[str]:
    base = _normalize(query)
    if not base:
        return []
    seen: set[str] = set()
    out: list[str] = []

    def add(s: str) -> None:
        s = _normalize(s)
        key = s.lower()
        if not s or key in seen:
            return
        seen.add(key)
        out.append(s)

    add(base)
    add(re.sub(r",?\s*book\s*\d+\s*$", "", base, flags=re.I))
    add(re.sub(r",?\s*\(book\s*\d+\)\s*$", "", base, flags=re.I))
    add(re.sub(r":\s*.+$", "", base))

    with_ab = [f"{v} audiobook" for v in out if "audiobook" not in v.lower()]
    return with_ab + out


_VIDEO_HINT = re.compile(
    r"1080p|2160p|720p|480p|bluray|blu[\s._-]?ray|brrip|webrip|web[\s._-]?dl|"
    r"x264|x265|h\.?264|h\.?265|hevc|yts|mkv|remux|\bhdr\b|"
    r"\b5\.1\b|\b7\.1\b|\batmos\b|\bdts\b",
    re.I,
)
_AUDIO_HINT = re.compile(
    r"audiobook|audio[\s._-]?book|\bm4b\b|unabridged|narrat|\.mp3\b|\.m4b\b|"
    r"librivox|full[\s._-]?cast",
    re.I,
)


def _score(title: str, seeders: int, size: int) -> int:
    t = title or ""
    # Cap seeder weight so popular movie rips cannot bury audiobooks.
    score = min(seeders or 0, 80) * 5
    audio = bool(_AUDIO_HINT.search(t))
    video = bool(_VIDEO_HINT.search(t))
    if audio:
        score += 8000
    if re.search(r"\.m4b\b", t, re.I):
        score += 1500
    if video and not audio:
        score -= 20000
    n = size or 0
    if 5e7 <= n <= 3.5e9:
        score += 120
    if n > 5e9 and not audio:
        score -= 5000
    return score


def _search(query: str, limit: int) -> list[dict]:
    variants = _variants(query)
    if not variants:
        return []

    merged: dict[str, dict] = {}
    for variant in variants:
        # torrents-csv
        try:
            csv_url = (
                "https://torrents-csv.com/service/search?"
                + urllib.parse.urlencode({"q": variant, "size": limit})
            )
            data = _fetch_json(csv_url)
            rows = (data or {}).get("torrents") if isinstance(data, dict) else None
            if rows:
                for r in rows:
                    h = (r.get("infohash") or r.get("infoHash") or "").lower()
                    if not h or h in merged:
                        continue
                    title = r.get("name") or r.get("title") or ""
                    size = int(r.get("size_bytes") or r.get("size") or 0)
                    seeds = int(r.get("seeders") or 0)
                    merged[h] = {
                        "infohash": h,
                        "title": title,
                        "size": size,
                        "seeders": seeds,
                        "source": "torrents-csv",
                        "_score": _score(title, seeds, size),
                    }
                print(f"[proxy] torrents-csv {variant!r} → {len(rows)}")
        except Exception as e:
            print(f"[proxy] torrents-csv failed for {variant!r}: {e}")

        # SolidTorrents fallback for this variant
        try:
            solid_url = (
                "https://solidtorrents.to/api/v1/search?"
                + urllib.parse.urlencode(
                    {
                        "q": variant,
                        "limit": limit,
                        "sort": "seeders",
                        "order": "desc",
                    }
                )
            )
            data = _fetch_json(solid_url)
            rows = (data or {}).get("results") if isinstance(data, dict) else None
            if rows:
                for r in rows:
                    h = (r.get("infohash") or r.get("infoHash") or "").lower()
                    if not h or h in merged:
                        continue
                    title = r.get("title") or r.get("name") or ""
                    size = int(r.get("size") or 0)
                    seeds = int(r.get("seeders") or 0)
                    merged[h] = {
                        "infohash": h,
                        "title": title,
                        "size": size,
                        "seeders": seeds,
                        "source": "solidtorrents",
                        "_score": _score(title, seeds, size),
                    }
                print(f"[proxy] solidtorrents {variant!r} → {len(rows)}")
        except Exception as e:
            print(f"[proxy] solidtorrents failed for {variant!r}: {e}")

        if len(merged) >= limit * 2:
            break

    ranked = sorted(merged.values(), key=lambda r: r.get("_score", 0), reverse=True)
    out = []
    for r in ranked[:limit]:
        r = dict(r)
        r.pop("_score", None)
        out.append(r)
    return out


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/api/torrent-search", "/api/search"):
            qs = urllib.parse.parse_qs(parsed.query)
            query = (qs.get("q") or [""])[0]
            try:
                limit = int((qs.get("limit") or qs.get("size") or ["20"])[0])
            except ValueError:
                limit = 20
            limit = max(1, min(limit, 100))
            try:
                results = _search(query, limit)
                body = json.dumps({"success": True, "results": results}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                print(f"[proxy] q={query!r} → {len(results)} hit(s)")
            except Exception as e:
                body = json.dumps({"success": False, "error": str(e), "results": []}).encode()
                self.send_response(502)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            return
        return super().do_GET()

    def log_message(self, fmt: str, *args) -> None:
        if args and str(args[0]).startswith("GET /api/"):
            return
        super().log_message(fmt, *args)


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"SoundLoom providers + search proxy on http://0.0.0.0:{PORT}")
    print(f"  index:  http://<lan-ip>:{PORT}/index.json")
    print(f"  search: http://<lan-ip>:{PORT}/api/torrent-search?q=...")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
