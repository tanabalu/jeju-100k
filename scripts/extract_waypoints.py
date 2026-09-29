#!/usr/bin/env python3
"""
Extract named waypoints + distances from the official Jeju Olle Trail route map PDF.

Source: https://jejuolletrailguide.net/wp-content/uploads/2017/10/171011_jeju-olle-route-map.pdf
The PDF is one route per page (cover + 26 route pages).  Waypoint markers on the map
are labeled with an English name and a distance along the route (e.g. "8.1km" or "5km").

Approach: each waypoint marker = a name segment + a distance segment placed close together
on the map.  We cluster all text segments by spatial proximity (connected components,
recursively split when a cluster holds more than one distance), then pair the single
distance with the name(s) inside each cluster.

Output: scripts/data/olle-waypoints.json
{
  "01": [
    { "name": "Mokhwa Rest Area", "distance": 8.1, "type": "restArea" },
    ...
  ],
  ...
}

Type inference is rule-based from the English name (icon legend of the PDF).  Inferred
types are best-effort from the 2017 map; routes whose geometry changed since (07/07-1/16/17)
or which lack a real track (18-2) should be dropped by the caller before load.
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import pdfplumber

PDF_URL = "https://jejuolletrailguide.net/wp-content/uploads/2017/10/171011_jeju-olle-route-map.pdf"
ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "scripts" / "data" / "olle-waypoints.json"


def download_pdf(target: Path) -> None:
    import urllib.request

    print(f"Downloading {PDF_URL} ...")
    urllib.request.urlretrieve(PDF_URL, target)
    print(f"Saved {target} ({target.stat().st_size} bytes)")


def make_segments(page: pdfplumber.page.Page) -> list[dict]:
    words = page.extract_words(x_tolerance=2, y_tolerance=2, keep_blank_chars=False)
    filtered: list[dict] = []
    for w in words:
        # Drop top banner, bottom elevation profile, right legend, and huge area labels.
        if w["top"] < 50 or w["top"] > 430:
            continue
        if w["x0"] > 620:
            continue
        if w["height"] > 9:
            continue
        filtered.append(w)

    # Group into horizontal lines by rounded y.
    filtered.sort(key=lambda w: (round(w["top"] / 3), w["x0"]))
    lines: list[list[dict]] = []
    cur_line: list[dict] = []
    cur_key: int | None = None
    for w in filtered:
        key = round(w["top"] / 3)
        if cur_key is None or key == cur_key:
            cur_line.append(w)
        else:
            lines.append(cur_line)
            cur_line = [w]
        cur_key = key
    if cur_line:
        lines.append(cur_line)

    # Within each line, split into segments by x gaps.
    segments: list[dict] = []
    for line in lines:
        line.sort(key=lambda w: w["x0"])
        seg: list[dict] = []
        for w in line:
            if seg and w["x0"] - seg[-1]["x1"] > 15:
                segments.append(_finalize_segment(seg))
                seg = []
            seg.append(w)
        if seg:
            segments.append(_finalize_segment(seg))
    return segments


def _finalize_segment(seg: list[dict]) -> dict:
    text = " ".join(w["text"] for w in seg)
    x0 = seg[0]["x0"]
    x1 = seg[-1]["x1"]
    y0 = min(w["top"] for w in seg)
    y1 = max(w["bottom"] for w in seg)
    return {
        "text": text,
        "x0": x0,
        "x1": x1,
        "y0": y0,
        "y1": y1,
        "xc": (x0 + x1) / 2,
        "yc": (y0 + y1) / 2,
    }


# Non-waypoint text fragments that leak from the map/legend but are not named waypoints.
IGNORE_NAME_PATTERNS = [
    re.compile(r"^\d+$"),  # road numbers: 1132, 1136, ...
    re.compile(r"^Jeju Olle Route$", re.I),
    re.compile(r"^Start Point$", re.I),
    re.compile(r"^Finish Point$", re.I),
    re.compile(r"^Detour$", re.I),
    re.compile(r"^Wheelchair Accessible Area$", re.I),
]


def is_ignored_name(text: str) -> bool:
    return any(p.match(text.strip()) for p in IGNORE_NAME_PATTERNS)


DIST_RE = re.compile(r"^(\d+(?:\.\d+)?)km$", re.I)


def split_component(segs: list[dict]) -> list[list[dict]]:
    """Recursively split a segment group until each piece has at most one distance."""
    dist_count = sum(1 for s in segs if DIST_RE.match(s["text"]))
    if dist_count <= 1:
        return [segs]
    # pick the axis (x or y) with the largest gap between consecutive segments
    for axis in ("y", "x"):
        keyf = (lambda s: (s["y0"] + s["y1"]) / 2) if axis == "y" else (lambda s: (s["x0"] + s["x1"]) / 2)
        segs_sorted = sorted(segs, key=keyf)
        centers = [keyf(s) for s in segs_sorted]
        max_gap, cut = 0, 0
        for i in range(1, len(centers)):
            gap = centers[i] - centers[i - 1]
            if gap > max_gap:
                max_gap, cut = gap, i
        if max_gap >= 12:
            return split_component(segs_sorted[:cut]) + split_component(segs_sorted[cut:])
    return [segs]


def parse_route_page(page: pdfplumber.page.Page) -> list[dict]:
    segments = make_segments(page)

    # Connected components by proximity (Euclidean center distance).
    n = len(segments)
    parent = list(range(n))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> None:
        parent[find(a)] = find(b)

    THRESH = 30
    for i in range(n):
        for j in range(i + 1, n):
            dx = segments[i]["xc"] - segments[j]["xc"]
            dy = segments[i]["yc"] - segments[j]["yc"]
            if (dx * dx + dy * dy) ** 0.5 < THRESH:
                union(i, j)

    comps: dict[int, list[dict]] = defaultdict(list)
    for i, s in enumerate(segments):
        comps[find(i)].append(s)

    waypoints: list[dict] = []
    for comp in comps.values():
        pieces = split_component(comp)
        for piece in pieces:
            dist_segs = [s for s in piece if DIST_RE.match(s["text"])]
            name_segs = [
                s for s in piece
                if not DIST_RE.match(s["text"]) and not is_ignored_name(s["text"])
            ]
            if len(dist_segs) != 1 or not name_segs:
                continue
            val = float(DIST_RE.match(dist_segs[0]["text"]).group(1))  # type: ignore[arg-type]
            name_segs.sort(key=lambda s: (s["yc"], s["xc"]))
            name = " ".join(s["text"] for s in name_segs)
            name = re.sub(r"\s+", " ", name).strip()
            # drop a trailing stray distance token if any leaked in
            name = re.sub(r"\s+\d+(?:\.\d+)?km$", "", name, flags=re.I).strip()
            if not name:
                continue
            waypoints.append({
                "name": name,
                "distance": val,
                "type": infer_type(name),
            })

    waypoints.sort(key=lambda w: w["distance"])
    return waypoints


def infer_type(name: str) -> str:
    n = name.lower()

    # Order matters: more specific before generic.
    if "restroom" in n:
        return "restroom"
    if "medical kit" in n or "first aid" in n:
        return "medical"
    if "rest area" in n or "shelter" in n:
        return "restArea"
    if "stamp station" in n:
        return "stamp"
    if "information center" in n or "information kiosk" in n:
        return "info"
    if any(k in n for k in ("terminal", "ferry", "harbor", "hang(port", "port", "bus stop", "parking")):
        return "transport"
    if any(k in n for k in (
        "peak", "viewpoint", "observatory", "top of", "(hill)",
        "oreum", "-bong", "bong(", "sanbang", "crater", "volcanic",
    )):
        return "viewpoint"
    return "normal"


def detect_route_code(page: pdfplumber.page.Page) -> str | None:
    text = page.extract_text() or ""
    m = re.search(r"Route\s+(\d{1,2}(?:-[\dA-Za-z]+)?)", text)
    if m:
        return normalize_code(m.group(1))
    mk = re.search(r"코스\s+(\d{1,2}(?:-[\dA-Za-z]+)?)", text)
    if mk:
        return normalize_code(mk.group(1))
    return None


def normalize_code(raw: str) -> str:
    if "-" in raw:
        main, sub = raw.split("-", 1)
        return f"{int(main):02d}-{sub}"
    return f"{int(raw):02d}"


def main() -> int:
    pdf_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/olle-route-map.pdf")
    if not pdf_path.exists():
        download_pdf(pdf_path)

    out: dict[str, list[dict]] = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            code = detect_route_code(page)
            if code is None:
                continue
            wps = parse_route_page(page)
            if wps:
                out[code] = wps
                print(f"  {code}: {len(wps)} waypoints")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {OUT_PATH} ({len(out)} routes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
