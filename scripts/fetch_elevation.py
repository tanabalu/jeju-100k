#!/usr/bin/env python3
"""给偶来小路 27 条路线生成地形剖面与累计爬升估算。

数据来源：opentopodata.org 公开的 SRTM 30m 高程数据集（WGS84）。
济州岛位于韩国境外，GCJ-02 与 WGS84 在此区域无偏移，可直接查询。

⚠️ 重要边界：本脚本产出的是「沿近似路径的地形估算」，不是官方实测爬升。
   - 非环线：沿「起点→终点」直线均匀采样（真实路线是海岸弯路，会低估）
   - 环线：按官方里程反推的圆周采样（真实环岛路线走向未知）
   仅用于让剖面图和爬升有量级可看，不能当训练/补给依据。

用法：
    python3 scripts/fetch_elevation.py --limit 2   # 先试 2 条
    python3 scripts/fetch_elevation.py             # 全量 27 条
    python3 scripts/fetch_elevation.py --dry       # 只算采样点不联网
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "src" / "lib" / "seed.ts"
OUT = ROOT / "src" / "lib" / "olleeElevation.ts"
CACHE = ROOT / "scripts" / ".cache" / "elevation.json"

API = "https://api.opentopodata.org/v1/srtm30m"
CHUNK = 100          # 单次请求最多 100 个位置
NOISE_M = 3.0        # 高程噪声阈值（米），小于此值的起伏不计入爬升
SLEEP = 2.0          # 免费接口限速，间隔留足
MAX_RETRY = 4        # 遇到 429 退避重试次数

PLACE_RE = re.compile(
    r"^\s*(\w+):\s*\{\s*zh:\s*'([^']*)',\s*ko:\s*'([^']*)',\s*lng:\s*(-?[\d.]+),\s*lat:\s*(-?[\d.]+)\s*\},",
    re.M,
)
SPEC_RE = re.compile(
    r"\{\s*code:\s*'([^']+)',\s*start:\s*'(\w+)',\s*end:\s*'(\w+)',\s*km:\s*([\d.]+)",
)


def parse_seed():
    text = SEED.read_text(encoding="utf-8")
    places = {
        m.group(1): (float(m.group(4)), float(m.group(5)))  # (lng, lat)
        for m in PLACE_RE.finditer(text)
    }
    specs = [
        (m.group(1), m.group(2), m.group(3), float(m.group(4)))
        for m in SPEC_RE.finditer(text)
    ]
    return places, specs


def build_samples(s: tuple[float, float], e: tuple[float, float], km: float):
    """返回 (basis, [(lng, lat), ...])"""
    is_loop = abs(s[0] - e[0]) < 1e-9 and abs(s[1] - e[1]) < 1e-9
    if is_loop:
        # 官方里程当作环线周长，反推半径画一个圆
        r_km = km / (2 * math.pi)
        dlat = r_km / 111.32
        dlng = r_km / (111.32 * math.cos(math.radians(s[1])))
        n = 36
        pts = [
            (
                s[0] + dlng * math.cos(2 * math.pi * i / n),
                s[1] + dlat * math.sin(2 * math.pi * i / n),
            )
            for i in range(n + 1)
        ]
        return "loop", pts
    n = max(12, min(48, int(round(km / 0.5))))
    pts = [(s[0] + (e[0] - s[0]) * i / n, s[1] + (e[1] - s[1]) * i / n) for i in range(n + 1)]
    return "line", pts


def query_elevations(points: list[tuple[float, float]]) -> list[float | None]:
    """points: [(lng, lat)] -> 海拔列表（米），失败为 None

    用 GET + `lat,lng|lat,lng` 形式（该接口的 POST/JSON 形式会返回 400）。
    """
    out: list[float | None] = []
    for i in range(0, len(points), CHUNK):
        chunk = points[i : i + CHUNK]
        loc = "|".join(f"{lat},{lng}" for lng, lat in chunk)
        url = f"{API}?locations={urllib.parse.quote(loc, safe=',|')}"
        data = None
        for attempt in range(MAX_RETRY):
            req = urllib.request.Request(
                url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "jeju-olle-100k/1.0 (elevation bootstrap)",
                },
                method="GET",
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                if data.get("status") == "OK":
                    break
                err = f"{data.get('status')} {data.get('error')}"
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                err = str(exc)
            # 429 / 5xx 退避后重试
            wait = SLEEP * (attempt + 1) * 2
            print(f"  第 {attempt + 1} 次失败（{err}），{wait:.0f}s 后重试", file=sys.stderr)
            time.sleep(wait)
            data = None
        if data is None or data.get("status") != "OK":
            print(f"  连续 {MAX_RETRY} 次失败，本段跳过", file=sys.stderr)
            out.extend([None] * len(chunk))
            continue
        for r in data.get("results", []):
            out.append(r.get("elevation"))
        if i + CHUNK < len(points):
            time.sleep(SLEEP)
    return out


def gain_loss(eles: list[float]) -> tuple[int, int]:
    """带噪声阈值的累计爬升/下降"""
    gain = loss = 0.0
    ref = eles[0]
    for e in eles[1:]:
        d = e - ref
        if d > NOISE_M:
            gain += d
            ref = e
        elif d < -NOISE_M:
            loss += -d
            ref = e
    return int(round(gain)), int(round(loss))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 条")
    ap.add_argument("--dry", action="store_true", help="不联网，只输出采样点结构")
    ap.add_argument("--force", action="store_true", help="忽略本地缓存，全部重抓")
    args = ap.parse_args()

    places, all_specs = parse_seed()
    if not all_specs:
        print("没从 seed.ts 解析到路线，检查文件格式", file=sys.stderr)
        return 1

    # 已抓到的结果缓存在本地，重复运行只补缺失的（免费接口有日限额）
    cache: dict[str, dict] = {}
    if CACHE.exists():
        try:
            cache = json.loads(CACHE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            cache = {}

    todo = [s for s in all_specs if args.force or s[0] not in cache]
    if args.limit:
        todo = todo[: args.limit]
    if cache:
        print(f"缓存已有 {len(cache)} 条，本次待抓 {len(todo)} 条")

    for code, s_key, e_key, km in todo:
        s = places[s_key]
        e = places[e_key]
        basis, pts = build_samples(s, e, km)
        if args.dry:
            print(f"{code:>5}  {basis}  {len(pts)} 点  {km} km")
            continue

        eles = query_elevations(pts)
        clean = [e for e in eles if isinstance(e, (int, float))]
        if len(clean) < 2:
            print(f"{code:>5}  高程获取失败，跳过", file=sys.stderr)
            continue

        # 个别点失败时用前一个有效值兜底，保持序列连续
        filled: list[float] = []
        last = clean[0]
        for e in eles:
            if isinstance(e, (int, float)):
                last = e
            filled.append(last)

        g, l = gain_loss(filled)
        cache[code] = {
            "basis": basis,
            "samples": [
                [round(p[0], 5), round(p[1], 5), int(round(el))] for p, el in zip(pts, filled)
            ],
        }
        print(
            f"{code:>5}  {basis:<4}  {len(pts):>3} 点  "
            f"爬升 {g:>4} m / 下降 {l:>4} m  最高 {int(max(filled))} m"
        )

    if args.dry:
        return 0

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    # 按 seed.ts 里的编号顺序输出，保证文件稳定
    ordered = [(c, cache[c]) for c, *_ in all_specs if c in cache]

    lines = [
        "/**",
        " * 偶来小路地形采样数据（自动生成，请勿手改）。",
        " *",
        " * 生成脚本：scripts/fetch_elevation.py",
        " * 高程来源：opentopodata.org 公开的 SRTM 30m 数据集（WGS84）。",
        " *",
        " * ⚠️ 这是「沿近似路径的地形估算」，不是官方实测爬升：",
        " *    basis='line' —— 沿起点→终点直线均匀采样（真实路线沿海岸蜿蜒，会低估爬升）",
        " *    basis='loop' —— 环线按官方里程反推的圆周采样（真实走向未知）",
        " * 爬升计算带 3m 噪声阈值，用于抑制 SRTM 在平坦地形的抖动。",
        " * 要拿来做实际行程判断，请用真实 GPX 轨迹替换。",
        " */",
        "",
        "export type ElevBasis = 'line' | 'loop' | 'track'",
        "",
        "export interface ElevSeries {",
        "  basis: ElevBasis",
        "  /** [lng, lat, ele] 采样序列，按路线顺序 */",
        "  samples: [number, number, number][]",
        "}",
        "",
        "/** 按偶来小路编号索引 */",
        "export const OLLE_ELEVATION: Record<string, ElevSeries> = {",
    ]
    for code, rec in ordered:
        items = ",".join(
            "[{},{},{}]".format(s[0], s[1], s[2]) for s in rec["samples"]
        )
        lines.append(f"  '{code}': {{ basis: '{rec['basis']}', samples: [{items}] }},")
    lines.append("}")
    lines.append("")
    lines.append("export const ELEVATION_SOURCE = 'SRTM 30m · opentopodata.org（沿近似路径采样估算）'")
    lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n写入 {OUT.relative_to(ROOT)}：{len(ordered)}/{len(all_specs)} 条路线")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
