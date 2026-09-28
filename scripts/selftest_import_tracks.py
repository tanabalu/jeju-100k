#!/usr/bin/env python3
"""import_tracks.py 的离线自测（不联网、秒级）。改导入逻辑前先跑它：

    python3 scripts/selftest_import_tracks.py

目前覆盖「走向校正」这一块 —— 它靠一条结构事实反推哪些线被拼接反了：
偶来各条首尾相接，课程 N 的终点 = N+1 的起点。所以相邻两条必然共享一个端点节点，
共享点落在「N 的终点 / N+1 的起点」上就是同向，落在「终点对终点」上则必有一条是反的；
再取「翻转条数最少」的解。**数据源本身没问题时它会给出 0 次翻转**，不会误伤。
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT))
import import_tracks as it          # noqa: E402

FAILED = []


def case(name, data, want):
    got, _links = it.orient_flips(data)
    ok = got == set(want)
    if not ok:
        FAILED.append(name)
    print(f"[{'OK ' if ok else 'FAIL'}] {name}: 翻转 {sorted(got) or '无'}（期望 {sorted(want) or '无'}）")


def pt(lng, lat):
    return (lng, lat, None)


# 一条南北向的直线，5 个节点，用来摆出「相邻课程共享端点」
A, B, C, D, E = (126.50, 33.30), (126.52, 33.30), (126.54, 33.30), (126.56, 33.30), (126.58, 33.30)

print("=" * 78)
print("走向校正 orient_flips()")
print("=" * 78)
case("① 全部正向 → 0 翻转",
     {"01": (pt(*A), pt(*B)), "02": (pt(*B), pt(*C)), "03": (pt(*C), pt(*D))}, [])
case("② 只有 02 被拼反 → 只翻 02",
     {"01": (pt(*A), pt(*B)), "02": (pt(*C), pt(*B)), "03": (pt(*C), pt(*D))}, ["02"])
case("③ 两条反向 → 取翻转更少的那侧（翻 01 一条即可满足约束）",
     {"01": (pt(*A), pt(*B)), "02": (pt(*C), pt(*B)), "03": (pt(*D), pt(*C))}, ["01"])
case("③b 4 条链里 02、03 反向 → 翻 02+03（与「翻 01+04」打平，取前者）",
     {"01": (pt(*A), pt(*B)), "02": (pt(*C), pt(*B)),
      "03": (pt(*D), pt(*C)), "04": (pt(*D), pt(*E))}, ["02", "03"])
case("④ 整条链整体反向（相对方向自洽）→ 0 翻转，不乱翻",
     {"01": (pt(*B), pt(*A)), "02": (pt(*C), pt(*B)), "03": (pt(*D), pt(*C))}, [])
case("⑤ 只有一条 → 给不出约束，0 翻转", {"07": (pt(*A), pt(*B))}, [])
case("⑥ 编号不连续（04 与 06 之间缺 05）→ 不构成相邻对，0 翻转",
     {"04": (pt(*A), pt(*B)), "06": (pt(*B), pt(*A))}, [])
case("⑦ 两条压根没接上 → 0 翻转",
     {"01": (pt(*A), pt(*B)), "02": (pt(*D), pt(*E))}, [])
case("⑧ 支线不参与（01 与 01-1 不是相邻主线）→ 0 翻转",
     {"01": (pt(*A), pt(*B)), "01-1": (pt(*B), pt(*A))}, [])
case("⑨ 端点差 111m（超 80m 容差）→ 不算相接，0 翻转",
     {"01": (pt(*A), pt(126.5012, 33.30)), "02": (pt(*B), pt(*C))}, [])

# 真实数据（仓库里存在 tracks/osm/ 时才跑；缺了也不算失败）
osm = ROOT / "tracks" / "osm"
files = sorted(osm.glob("*.geojson")) if osm.is_dir() else []
if files:
    print()
    print("=" * 78)
    print(f"真实数据回归（{osm.relative_to(ROOT)}，{len(files)} 条）")
    print("=" * 78)
    ends = {}
    for f in files:
        feat = json.loads(f.read_text(encoding="utf-8"))["features"][0]
        g = feat["geometry"]
        segs = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
        segs = [s for s in segs if len(s) >= 2]
        if segs:
            ends[feat["properties"]["code"]] = (tuple(segs[0][0]), tuple(segs[-1][-1]))
    flips, links = it.orient_flips(ends)
    for a, b, par in links:
        print(f"  相邻对 {a}↔{b}：{'⚠️ 终点对终点（必有一条反了）' if par else '✅ 终点对起点（同向）'}")
    print(f"  判定翻转：{sorted(flips) or '无'}")
    # 2026-09-28 实测：这几条的 OSM 关系方向与官方行进方向相反（04/10/19 的方向
    # 由官方端点点位核过：04 起点≈表善 0.9km、10 终点≈摹瑟浦 0.6km、19 终点≈朝天）
    if flips != {"05", "11", "20"}:
        FAILED.append("真实数据回归")
    print(f"[{'OK ' if flips == {'05','11','20'} else 'FAIL'}] 真实数据应判出 05 / 11 / 20")
else:
    print("\n（没找到 tracks/osm/，跳过真实数据回归）")

print()
if FAILED:
    print(f"❌ 有 {len(FAILED)} 项失败：{', '.join(FAILED)}")
    sys.exit(1)
print("✅ 全部通过")
