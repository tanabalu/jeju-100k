"""对齐相邻主线课程的首尾节点；默认只报告，传 --apply 写回 public/tracks.json。"""

import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "tracks.json"
EARTH_M = 6_371_008.8


def distance_m(a, b):
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_M * math.asin(min(1, math.sqrt(h)))


def path_km(points):
    return sum(distance_m(a, b) for a, b in zip(points, points[1:])) / 1000


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-gap", type=float, default=150,
                        help="自动接合的最大端点间距（米，默认 150）")
    parser.add_argument("--apply", action="store_true", help="写回 tracks.json；省略时仅预览")
    args = parser.parse_args()

    data = json.loads(DATA.read_text(encoding="utf-8"))
    edits = []
    for number in range(1, 21):
        prev_code, next_code = f"{number:02d}", f"{number + 1:02d}"
        prev, nxt = data.get(prev_code), data.get(next_code)
        if not prev or not nxt or not prev.get("points") or not nxt.get("points"):
            continue
        end = prev["points"][-1]
        start = nxt["points"][0]
        gap = distance_m(end, start)
        if gap > args.max_gap:
            print(f"保留 {prev_code}→{next_code}: {gap:.1f}m > {args.max_gap:g}m")
            continue
        if gap < 0.5:
            # 规范成完全相同的接点，避免浮点误差造成微小缝隙。
            nxt["points"][0][:2] = end[:2]
            if nxt.get("segments"):
                nxt["segments"][0][0][:2] = end[:2]
        else:
            # 保留原始 GPS 起点，在其前面加上上一课程的终点，明确画出短连接段。
            connector = [end[0], end[1], end[2] if len(end) > 2 else None]
            nxt["points"].insert(0, connector)
            if nxt.get("segments"):
                nxt["segments"][0].insert(0, connector.copy())
        all_segments = nxt.get("segments") or [nxt["points"]]
        nxt["km"] = round(sum(path_km(segment) for segment in all_segments), 2)
        nxt["mainlineJoinFrom"] = prev_code
        nxt["mainlineJoinGapM"] = round(gap, 1)
        edits.append((prev_code, next_code, gap))

    for a, b, gap in edits:
        print(f"{'接合' if args.apply else '预览'} {a}→{b}: {gap:.1f}m")
    if args.apply and edits:
        DATA.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"已写入 {DATA}")
    elif not args.apply:
        print("未修改文件；确认预览后使用 --apply 写回。")


if __name__ == "__main__":
    main()
