#!/usr/bin/env python3
"""给 `public/tracks.json` 里「没有海拔」的轨迹补高程（SRTM 30m，沿真实轨迹逐点补采样）。

为什么单独一个脚本：`import_tracks.py --elevation` 只在**导入**时补，已经入库的
条目（如 06 / 07，当年导入时没加 --elevation）没机会补。本脚本就地补这些条目。

⚠️ tracks.json 是单行紧凑 JSON，直接 `json.dump` 整个重写会让 git diff 变成一整行噪声。
   本脚本只做**精确文本替换**：定位 `"<code>":{...}` 这一块（字符串感知的花括号配平），
   只把这一块换成新序列化结果，其余字节一律不动。

用法：
    python3 scripts/fill_track_elevation.py            # 补所有缺海拔的条目
    python3 scripts/fill_track_elevation.py --codes 06 07
    python3 scripts/fill_track_elevation.py --dry      # 只报告哪些缺，不联网不写入
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

TRACKS = ROOT / "public" / "tracks.json"

ELEV_SOURCE = "轨迹本身无海拔，用 SRTM 30m 沿轨迹逐点补采样"


def load_elev_module():
    """复用 import_tracks.py 里现成的补采逻辑（缓存 / 限速 / 退避都写好了）。"""
    import import_tracks  # noqa: PLC0415

    return import_tracks


def entry_span(text: str, code: str) -> tuple[int, int]:
    """返回 `"<code>":{...}` 在文本中的 [start, end) 区间（字符串感知）。"""
    key = f'"{code}":'
    i = text.index(key)
    j = i + len(key)
    if text[j] != "{":
        raise ValueError(f"{code} 后面不是对象")
    depth = 0
    in_str = False
    esc = False
    for k in range(j, len(text)):
        c = text[k]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i, k + 1
    raise ValueError(f"{code} 对象没有闭合")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--codes", nargs="+", default=[], help="只补这几条，默认补所有缺海拔的")
    ap.add_argument("--dry", action="store_true", help="只报告，不联网不写入")
    args = ap.parse_args()

    text = TRACKS.read_text(encoding="utf-8")
    tracks = json.loads(text)

    missing = [
        c
        for c in tracks
        if not any(
            isinstance(p, list) and len(p) >= 3 and isinstance(p[2], (int, float))
            for p in (tracks[c].get("points") or [])
        )
    ]
    todo = args.codes or missing
    todo = [c for c in todo if c in tracks]
    unknown = [c for c in (args.codes or []) if c not in tracks]
    if unknown:
        print(f"tracks.json 里没有：{', '.join(unknown)}", file=sys.stderr)

    print(f"缺海拔的条目：{', '.join(missing) or '（无）'}")
    print(f"本次处理：{', '.join(todo) or '（无）'}")
    if args.dry or not todo:
        return 0

    it = load_elev_module()
    cache = it.load_elev_cache()

    out = text
    # 先全部算出新值，再一次性替换（避免替换后偏移影响后续定位）
    for code in todo:
        entry = tracks[code]
        pts = [p for p in entry["points"] if isinstance(p, list) and len(p) >= 2]
        print(f"\n{code}：{len(pts)} 点，开始补采")
        eles = it.fill_elevations([(p[0], p[1]) for p in pts], cache)
        if not any(isinstance(e, (int, float)) for e in eles):
            print(f"{code}：补采失败，保持原样", file=sys.stderr)
            continue

        for p, e in zip(pts, eles):
            if len(p) >= 3:
                p[2] = None if e is None else round(float(e))
            else:
                p.append(None if e is None else round(float(e)))

        clean = [e for e in eles if isinstance(e, (int, float))]
        gain, loss = it.gain_loss([round(float(e)) for e in clean])
        entry["points"] = pts
        entry["gainM"] = gain
        entry["lossM"] = loss
        entry["highestM"] = int(round(max(clean)))
        entry["lowestM"] = int(round(min(clean)))
        entry["elevSource"] = ELEV_SOURCE
        print(f"{code}：爬升 {gain}m / 下降 {loss}m / 最高 {entry['highestM']}m")

        start, end = entry_span(out, code)
        block = json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
        out = out[:start] + f'"{code}":' + block + out[end:]

    it.save_elev_cache(cache)

    if out != text:
        TRACKS.write_text(out, encoding="utf-8")
        print(f"\n已写入 {TRACKS.relative_to(ROOT)}（只替换了 {len(todo)} 块，其余字节未动）")
    else:
        print("\n没有变化，未写入")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
