"""
固化 27 条偶来小路的**权威起终点** → `src/data/olle-endpoints.json`。

为什么需要它（2026-09-29 事故复盘）：
  `seed.ts` 里 `PLACES` 是「城镇/地点级近似坐标」，实测 23/27 偏差 >1km、最大 6.7km。
  平时靠 `DataContext.snapRouteEnds` 运行时吸附到 `tracks.json` 首尾盖住它，
  一旦吸附判定失效（本次：加了途经点后点数对不上被误判成"用户手工改过"），
  起终点就直接退回那批陈旧坐标 —— 01 起点偏 5.29km、终点偏 6.35km。

  所以把起终点**钉死**到一份可审阅、可复跑对账的 JSON 里，不再依赖运行时推导。

取值策略：
  - `source: "track"`   默认。取 `public/tracks.json` 该线的首/末点（主线首尾相接，是事实基准）。
  - `source: "official"` 仅 06/07/07-1(终点) —— jejuolle.org 官方 GPS 标注点。

配 `scripts/check_endpoints.py` 三向对账（JSON ↔ tracks.json ↔ PLACES），改完必跑。

用法：python3 scripts/build_endpoints_data.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = ROOT / "src" / "lib" / "seed.ts"
TRACKS_PATH = ROOT / "public" / "tracks.json"
OUT_PATH = ROOT / "src" / "data" / "olle-endpoints.json"

# 官方 GPS 覆盖：code -> (端点, PLACES key, 来源说明)
OFFICIAL: dict[str, dict[str, tuple[str, str]]] = {
    "06": {
        "start": ("soesokkak", "jejuolle.org 官方 GPS（= 05 号线真实轨迹终点）"),
        "end": ("olleCenter", "jejuolle.org 官方 GPS"),
    },
    "07": {
        "start": ("olleCenter", "jejuolle.org 官方 GPS"),
        "end": ("seogwipoTerminal", "jejuolle.org 官方 GPS"),
    },
    "07-1": {
        "end": ("olleCenter", "jejuolle.org 官方 GPS（= 07 号线起点，同一地点）"),
    },
}


def parse_places(seed_text: str) -> dict[str, dict[str, object]]:
    out: dict[str, dict[str, object]] = {}
    for m in re.finditer(
        r"(\w+):\s*\{\s*zh:\s*'([^']*)',\s*ko:\s*'([^']*)',\s*lng:\s*([-\d.]+),\s*lat:\s*([-\d.]+)",
        seed_text,
    ):
        out[m.group(1)] = {
            "zh": m.group(2),
            "ko": m.group(3),
            "lng": float(m.group(4)),
            "lat": float(m.group(5)),
        }
    return out


def parse_specs(seed_text: str) -> dict[str, tuple[str, str]]:
    out: dict[str, tuple[str, str]] = {}
    # 编号要认得带 A/B 的（`03-A` / `15-B`）—— 只匹配 `[\d-]+` 会把这几条整条漏掉，
    # 表现为 olle-endpoints.json 少 4 个键、这几条线退回 PLACES 的城镇级近似坐标。
    for m in re.finditer(r"code:\s*'([\d\-AB]+)',\s*start:\s*'(\w+)',\s*end:\s*'(\w+)'", seed_text):
        out[m.group(1)] = (m.group(2), m.group(3))
    return out


def main() -> int:
    seed_text = SEED_PATH.read_text(encoding="utf-8")
    places = parse_places(seed_text)
    specs = parse_specs(seed_text)
    tracks = json.loads(TRACKS_PATH.read_text(encoding="utf-8"))

    result: dict[str, dict] = {}
    reports: list[str] = []

    for code, (skey, ekey) in specs.items():
        entry = tracks.get(code)
        if not entry:
            reports.append(f"{code}: ⚠️ tracks.json 无此线，跳过")
            continue
        pts = entry["points"]
        official = OFFICIAL.get(code, {})

        def build(side: str, key: str) -> dict:
            src = official.get(side)
            if src:
                pkey, ref = src
                p = places.get(pkey)
                if not p:
                    raise SystemExit(f"{code}.{side}: PLACES 缺 {pkey}")
                return {
                    "key": pkey,
                    "zh": p["zh"],
                    "ko": p["ko"],
                    "lng": p["lng"],
                    "lat": p["lat"],
                    "source": "official",
                    "ref": ref,
                }
            pt = pts[0] if side == "start" else pts[-1]
            p = places.get(key)
            if not p:
                raise SystemExit(f"{code}.{side}: PLACES 缺 {key}")
            return {
                "key": key,
                "zh": p["zh"],
                "ko": p["ko"],
                "lng": round(pt[0], 6),
                "lat": round(pt[1], 6),
                "source": "track",
            }

        result[code] = {"start": build("start", skey), "end": build("end", ekey)}
        s, e = result[code]["start"], result[code]["end"]
        reports.append(f"{code}: {s['source']:8} {s['lng']:.6f},{s['lat']:.6f} → {e['source']:8} {e['lng']:.6f},{e['lat']:.6f}")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"✅ 写入 {OUT_PATH.relative_to(ROOT)}（{len(result)} 条）")
    for r in reports:
        print("   " + r)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
