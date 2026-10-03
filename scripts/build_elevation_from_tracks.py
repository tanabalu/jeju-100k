#!/usr/bin/env python3
"""把 `public/tracks.json` 的真实轨迹转成 seed 用的高程序列 `src/lib/olleeElevation.ts`。

为什么要这个脚本：
    路线的高程序列以前是「沿起终点直线 / 环线圆周」采样 SRTM 得到的**估算值**
    （旧的 scripts/fetch_elevation.py，已删）。现在 29 条里 28 条已有真实轨迹，
    轨迹点自带海拔，直接拿它当高程序列即可 —— 口径与运行时 `DataContext.mergeTrack`
    完全一致，首屏不再出现「估算剖面 → 真实剖面」的跳变。

数据来源：
    public/tracks.json（`scripts/import_tracks.py` 从 GPX/KML/GeoJSON 导入；
    轨迹本身无海拔时由 import_tracks.py 用 SRTM 30m 沿轨迹补采样）。

用法：
    python3 scripts/build_elevation_from_tracks.py

缺轨迹的路线（如 15-B）不会写入文件 —— seed 读不到就留空，
详情页显示「暂缺海拔数据」，不用估算值冒充。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRACKS = ROOT / "public" / "tracks.json"
SEED = ROOT / "src" / "lib" / "seed.ts"
OUT = ROOT / "src" / "lib" / "olleeElevation.ts"

# 坐标 5 位小数 ≈ 1.1m，画剖面足够了；海拔取整数米
COORD_NDIGITS = 5


def parse_seed_codes() -> list[str]:
    """按 seed.ts 里 SPECS 的书写顺序取路线编号，保证输出顺序稳定。"""
    text = SEED.read_text(encoding="utf-8")
    return re.findall(r"\{\s*code:\s*'([^']+)'", text)


def fmt(v: float) -> str:
    """去掉多余的 0（`126.90410` → `126.9041`），文件更小更可读。"""
    s = f"{round(v, COORD_NDIGITS):.{COORD_NDIGITS}f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def main() -> int:
    if not TRACKS.exists():
        print(f"找不到 {TRACKS}，先跑 scripts/import_tracks.py", file=sys.stderr)
        return 1
    tracks = json.loads(TRACKS.read_text(encoding="utf-8"))
    codes = parse_seed_codes()
    if not codes:
        print("没从 seed.ts 解析到路线编号，检查文件格式", file=sys.stderr)
        return 1

    lines = [
        "/**",
        " * 偶来小路高程序列（自动生成，请勿手改）。",
        " *",
        " * 生成脚本：scripts/build_elevation_from_tracks.py",
        " * 数据来源：public/tracks.json 的真实轨迹点（轨迹无海拔时由 SRTM 30m 沿轨迹补采样）。",
        " *",
        " * 与运行时 `DataContext.mergeTrack` 用的是同一份轨迹，所以两者口径完全一致：",
        " * 首屏看到的就是真实剖面，不会再出现「估算剖面被真实轨迹覆盖」的跳变。",
        " * 缺轨迹的路线（15-B）不在本表里，seed 读到空就留空，详情页显示「暂缺海拔数据」。",
        " */",
        "",
        "export type ElevBasis = 'track'",
        "",
        "export interface ElevSeries {",
        "  basis: ElevBasis",
        "  /** [lng, lat, ele] 序列，按轨迹顺序 */",
        "  samples: [number, number, number][]",
        "}",
        "",
        "/** 按偶来小路编号索引（只有已导入真实轨迹的路线） */",
        "export const OLLE_ELEVATION: Record<string, ElevSeries> = {",
    ]

    written = 0
    for code in codes:
        entry = tracks.get(code)
        pts = entry.get("points") if isinstance(entry, dict) else None
        if not isinstance(pts, list):
            continue
        samples: list[str] = []
        for p in pts:
            if not (isinstance(p, list) and len(p) >= 3):
                continue
            lng, lat, ele = p[0], p[1], p[2]
            if not all(isinstance(x, (int, float)) for x in (lng, lat, ele)):
                continue
            if ele is None:
                continue
            # 海拔保留原始精度：GPX 自带海拔是 0.1m 级小数（SRTM 补采的才是整数米），
            # 一律取整会让 09 / 14-1 / 18-1 / 18-2 的累计爬升少算几米。
            samples.append(f"[{fmt(lng)},{fmt(lat)},{fmt(ele)}]")
        if len(samples) < 2:
            continue
        lines.append(f"  '{code}': {{ basis: 'track', samples: [{','.join(samples)}] }},")
        written += 1

    lines.append("}")
    lines.append("")
    lines.append("export const ELEVATION_SOURCE = '真实轨迹点（GPX/KML/GeoJSON 导入，缺海拔处由 SRTM 30m 沿轨迹补采样）'")
    lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8")
    missing = [c for c in codes if c not in tracks]
    print(f"写入 {OUT.relative_to(ROOT)}：{written}/{len(codes)} 条路线")
    if missing:
        print(f"缺轨迹未写入：{', '.join(missing)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
