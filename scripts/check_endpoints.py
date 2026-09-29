"""
起终点三向对账：`src/data/olle-endpoints.json` ↔ `public/tracks.json` ↔ `seed.ts` 的 PLACES。

固化是把起终点从「运行时推导」改成「文件里的钉死值」，代价是 tracks.json 再被校正时
不会自动跟随 —— 所以必须有一个可复跑的闸门，否则固化值会悄悄过时。

检查项：
  1. code 集合：endpoints.json 与 SPECS 是否一一对应（不多不少）
  2. source=track   ：固化值 vs tracks.json 首末点，偏差 > 50m 报警（轨迹已变，需重新固化）
  3. source=official：固化值 vs PLACES 中标注「官方 GPS」的值，必须完全一致
  4. PLACES 代表值  ：与按线的固化值差异（同地名在不同线路端点本就不同，仅提示）

用法：
    python3 scripts/check_endpoints.py           # 只检查
    python3 scripts/check_endpoints.py --fix     # 用 tracks.json 首尾回填 source=track 的固化值
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EP_PATH = ROOT / "src" / "data" / "olle-endpoints.json"
TRACKS_PATH = ROOT / "public" / "tracks.json"
SEED_PATH = ROOT / "src" / "lib" / "seed.ts"

WARN_M = 50.0  # 固化值与轨迹首末点的容差


def hav(a: tuple[float, float], b: tuple[float, float]) -> float:
    R = 6371000.0
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    x = 2 * (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[0] - a[0]) / 2) ** 2
    ) ** 0.5
    return R * math.asin(min(1.0, x / 2))


def parse_places(text: str) -> dict[str, tuple[float, float]]:
    out = {}
    for m in re.finditer(
        r"(\w+):\s*\{\s*zh:\s*'[^']*',\s*ko:\s*'[^']*',\s*lng:\s*([-\d.]+),\s*lat:\s*([-\d.]+)", text
    ):
        out[m.group(1)] = (float(m.group(2)), float(m.group(3)))
    return out


def parse_specs(text: str) -> dict[str, tuple[str, str]]:
    return {
        m.group(1): (m.group(2), m.group(3))
        for m in re.finditer(r"code:\s*'([\d-]+)',\s*start:\s*'(\w+)',\s*end:\s*'(\w+)'", text)
    }


def main() -> int:
    fix = "--fix" in sys.argv
    ep = json.loads(EP_PATH.read_text(encoding="utf-8"))
    tracks = json.loads(TRACKS_PATH.read_text(encoding="utf-8"))
    seed_text = SEED_PATH.read_text(encoding="utf-8")
    places = parse_places(seed_text)
    specs = parse_specs(seed_text)

    problems: list[str] = []
    infos: list[str] = []

    # 1. code 集合
    missing = sorted(set(specs) - set(ep))
    extra = sorted(set(ep) - set(specs))
    if missing:
        problems.append(f"endpoints.json 缺线路: {', '.join(missing)}")
    if extra:
        problems.append(f"endpoints.json 多出线路: {', '.join(extra)}")

    print(f"{'code':<6}{'side':<6}{'source':<9}{'与轨迹首末偏差':>14}{'与PLACES偏差':>14}  说明")
    print("-" * 78)

    changed = False
    for code in sorted(ep, key=lambda c: (len(c), c)):
        spec = specs.get(code)
        track = tracks.get(code)
        for side in ("start", "end"):
            d = ep[code][side]
            cur = (d["lng"], d["lat"])

            # 2/3. 与轨迹首末点
            dev_track = None
            if track:
                pt = track["points"][0] if side == "start" else track["points"][-1]
                dev_track = hav(cur, (pt[0], pt[1]))
                if d["source"] == "track":
                    if dev_track > WARN_M:
                        problems.append(
                            f"{code}.{side}: 固化值偏离 tracks.json 首末点 {dev_track:.0f}m "
                            f"（轨迹已变，重跑 build_endpoints_data.py 或 --fix）"
                        )
                    if fix and dev_track > 0.5:
                        ep[code][side]["lng"] = round(pt[0], 6)
                        ep[code][side]["lat"] = round(pt[1], 6)
                        changed = True
                else:  # official
                    off = places.get(d["key"])
                    if off and hav(cur, off) > 1.0:
                        problems.append(
                            f"{code}.{side}: source=official 但与 PLACES 官方 GPS 值差 {hav(cur, off):.0f}m"
                        )
            else:
                problems.append(f"{code}: tracks.json 无此线")

            # 4. 与 PLACES 代表值
            dev_place = None
            if spec:
                key = spec[0] if side == "start" else spec[1]
                p = places.get(key)
                if p:
                    dev_place = hav(cur, p)

            flag = ""
            if d["source"] == "official":
                flag = "官方 GPS 钉死"
            elif dev_track and dev_track > WARN_M:
                flag = "⚠️ 轨迹已变"
            elif dev_place and dev_place > WARN_M:
                flag = "PLACES 仅代表值"
            print(
                f"{code:<6}{side:<6}{d['source']:<9}"
                f"{(f'{dev_track:.0f}m' if dev_track is not None else '-'):>14}"
                f"{(f'{dev_place:.0f}m' if dev_place is not None else '-'):>14}  {flag}"
            )
            if dev_place and dev_place > WARN_M:
                infos.append(f"{code}.{side}: 与 PLACES 代表值差 {dev_place:.0f}m（同地名多线端点不同，属预期）")

    if changed:
        EP_PATH.write_text(json.dumps(ep, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"\n✅ --fix 已用 tracks.json 首末点回填 {EP_PATH.relative_to(ROOT)}")

    print()
    if infos:
        print("ℹ️ 提示（不算错误）：")
        for i in infos[:12]:
            print("   " + i)
        if len(infos) > 12:
            print(f"   … 其余 {len(infos) - 12} 条同类")
        print()

    if problems:
        print("❌ 发现问题：")
        for p in problems:
            print("   " + p)
        return 1

    print("✅ 三向对账通过：固化值 / 轨迹首末 / PLACES 官方值一致")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
