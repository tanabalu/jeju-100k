#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
逐条对账：`src/lib/seed.ts` 的 SPECS（官方口径） ↔ `public/tracks.json`（实际几何）。

为什么要这个脚本
----------------
页面上的「里程」走的是 `manualDistanceKm`（= SPECS.km，官方值），
**不是**轨迹算出来的（见 `src/lib/geo.ts` 的 computeMetrics）；
而「爬升」和「图上那根线」走的是轨迹。所以：
  · 里程对不上 → 一定是 SPECS 写错了；
  · 爬升离谱   → 一定是轨迹几何不对（或断口被当成直线算了）。
两边必须分开查，混在一起看会一直找错地方。

用法
----
    python3 scripts/check_official_consistency.py
    python3 scripts/check_official_consistency.py --tracks public/tracks.json

判定口径（与 fetch_olle_osm.py 的闸门一致）
  · |偏差| ≤ 5%   ✅ 对齐
  · 5% < |偏差| ≤ 10% ⚠️ 留意（可能是官方改线、或轨迹少画一段）
  · |偏差| > 10%  ⛔ 几乎可以肯定不是同一条走法，不该当实测轨迹用
"""

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import fetch_olle_osm as F  # noqa: E402  haversine_m / path_len_m

SEED = os.path.join(ROOT, "src", "lib", "seed.ts")

OK_PCT, WARN_PCT = 5.0, 10.0


def parse_seed(path):
    """从 seed.ts 解析 PLACES 与 SPECS —— 只有一处真源，绝不抄副本。"""
    src = open(path, encoding="utf-8").read()

    places = {}
    for m in re.finditer(
        r"^\s*(\w+):\s*\{[^}]*?lng:\s*([-\d.]+),\s*lat:\s*([-\d.]+)[^}]*\},", src, re.M
    ):
        places[m.group(1)] = (float(m.group(2)), float(m.group(3)))

    # 中文/韩文名，用来和官方 App 快照的字面比对（只报译名差异，不当错误）
    names = {}
    for m in re.finditer(
        r"^\s*(\w+):\s*\{\s*zh:\s*'([^']+)',\s*ko:\s*'([^']+)'", src, re.M
    ):
        names[m.group(1)] = (m.group(2), m.group(3))

    specs = []
    # ⚠️ 编号里现在带 A/B（3 号线、15 号线各分山线 / 海线两条走法），字符集要放开到字母
    for m in re.finditer(
        r"\{\s*code:\s*'([\d\-AB]+)',\s*start:\s*'(\w+)',\s*end:\s*'(\w+)',\s*"
        r"km:\s*([\d.]+),\s*difficulty:\s*'(\w+)'([^}]*)\}",
        src,
    ):
        tail = m.group(6)
        specs.append(
            {
                "code": m.group(1),
                "start": m.group(2),
                "end": m.group(3),
                "km": float(m.group(4)),
                "difficulty": m.group(5),
                "branch": "branch: true" in tail,
            }
        )

    # ⚠️ 只有标了「// 官方 GPS」的地点才够格当**端点判据**。
    #    其余是城镇/地点级近似坐标（seed.ts 自己写明偏差可达 10km，实测 siheung 偏 10km、
    #    yongsu 偏 13km）—— 拿它算「轨迹端点离官方地点多远」会得出 7~13km 的假警报，
    #    把真正的问题（如 07 的 3.7km）淹掉。
    gps = set(re.findall(r"^\s*(\w+):\s*\{[^}]*\}\s*,\s*//\s*官方 GPS", src, re.M))

    if len(specs) < 25 or len(places) < 25 or not gps:
        raise SystemExit(
            f"❌ 只解析出 {len(specs)} 条 SPECS / {len(places)} 个 PLACES / "
            f"{len(gps)} 个官方 GPS 点 —— seed.ts 的写法可能变了。"
            "修好再跑，别退回空表（空表会让整张报表静默失效）。"
        )
    return places, specs, gps, names


# --- 官方 App 快照口径 ------------------------------------------------------
# App 把 3 号线和 15 号线各列成 A/B 两条走法（A 山线 / B 海线）。
# 2026-10-03 起站内编号与 App **逐个对齐**（`03-A`/`03-B`、`15-A`/`15-B`），
# 所以这里不再需要任何别名换算 —— 一旦又要归一，说明编号口径又退回了「只记 A 线」，
# 那会让 B 线永远以「App 有、seed 缺」的 ⚠️ 混在报表里，看不出是真缺还是别名没配。
APP_BASELINE = os.path.join(HERE, "data", "olle-app-routes.json")


def check_app(places, specs, names, app_path):
    """把 seed.ts 的 SPECS 与**官方 App 快照**逐条对。

    为什么单独做这一层：这是**外部权威基准**，与「seed.ts ↔ tracks.json」那种内部
    自洽是完全不同的两件事。手头出过「拿网上流传的手绘旧图当官方口径」的事故，
    所以基准必须固化下来、可复跑，而不是每次靠临时读图。
    """
    if not app_path or not os.path.exists(app_path):
        print(f"\n（跳过官方 App 对账：没找到 {app_path}）")
        return 0

    routes = json.load(open(app_path, encoding="utf-8"))["routes"]
    by_code = {}
    for r in routes:
        by_code.setdefault(r["code"], []).append(r)

    spec_by = {s["code"]: s for s in specs}

    print()
    print("=" * 118)
    print("seed.ts SPECS × 官方 App 快照（现行官方口径）逐条对账")
    print("=" * 118)

    bad_km, missing, extra, aliases = [], [], [], []
    for code in sorted(by_code, key=lambda c: [int(x) if x.isdigit() else 9999 for x in c.split("-")]):
        r = by_code[code][0]
        sp = spec_by.get(code)
        if sp is None:
            missing.append((code, r["zh"], r["km"]))
            continue
        if abs(sp["km"] - r["km"]) > 0.05:
            bad_km.append((code, r["km"], sp["km"]))
        # 译名比对（App 的 "起点 - 终点" vs PLACES 的 zh）
        if " - " in r["zh"]:
            a_zh, b_zh = [x.strip() for x in r["zh"].split(" - ", 1)]
            sa = names.get(sp["start"], ("", ""))[0]
            sb = names.get(sp["end"], ("", ""))[0]
            if (a_zh, b_zh) != (sa, sb):
                aliases.append((code, r["zh"], f"{sa} - {sb}"))

    for code in spec_by:
        if code not in by_code:
            extra.append(code)

    print(f"{'编号':<7}{'App 起终点':<30}{'App km':>7} | {'seed 起终点':<30}{'seed km':>8}  判定")
    print("-" * 118)
    for code in sorted(by_code, key=lambda c: [int(x) if x.isdigit() else 9999 for x in c.split("-")]):
        r = by_code[code][0]
        sp = spec_by.get(code)
        if sp is None:
            print(f"{code:<7}{r['zh']:<30}{r['km']:>7} | {'—':<30}{'—':>8}  ⚠️ App 有、seed 缺")
            continue
        mine = f"{names.get(sp['start'], ('?',))[0]} - {names.get(sp['end'], ('?',))[0]}"
        same_km = abs(sp["km"] - r["km"]) <= 0.05
        print(f"{code:<7}{r['zh']:<30}{r['km']:>7} | {mine:<30}{sp['km']:>8}  "
              f"{'✅ 里程一致' if same_km else '❌ 里程不一致'}")

    print("-" * 118)
    print(f"App 共 {len(by_code)} 个编号（含 3A/3B、15A/15B 各算两条）／seed 共 {len(specs)} 条")
    if bad_km:
        print(f"\n❌ 里程不一致 {len(bad_km)} 条：")
        for code, a, m in bad_km:
            print(f"   {code:<6} App {a} / seed {m}  （差 {m - a:+.1f}）")
    else:
        print("\n✅ 里程：逐条全部一致")
    if missing:
        print(f"\n⚠️ App 里有、seed.ts 没有的编号 {len(missing)} 条：")
        for code, zh, km in missing:
            print(f"   {code:<6} {zh} {km}km")
    if extra:
        print(f"\n❌ seed.ts 有、App 里没有的编号：{extra}")
    if aliases:
        print(f"\nℹ️ 译名与 App 不同 {len(aliases)} 处（不是数据错误，仅供决定要不要对齐）：")
        for code, a, b in aliases:
            print(f"   {code:<6} App「{a}」 vs seed「{b}」")
    return len(bad_km) + len(extra) + len(missing)


def track_lines(entry):
    """tracks.json 的 points/segments → 折线列表"""
    raw = entry.get("segments")
    if isinstance(raw, list) and raw:
        out = []
        for seg in raw:
            pts = [(p[0], p[1]) for p in seg if isinstance(p, (list, tuple)) and len(p) >= 2]
            if len(pts) >= 2:
                out.append(pts)
        if out:
            return out
    pts = [(p[0], p[1]) for p in entry.get("points", []) if isinstance(p, (list, tuple)) and len(p) >= 2]
    return [pts] if len(pts) >= 2 else []


def next_place_code(specs, key, idx):
    """官方各线首尾相接：第 i 条的终点 = 第 i+1 条的起点。
    用它来交叉验证「终点是否接得上下一条」——比拿近似坐标量距离靠谱。"""
    for j in range(idx + 1, len(specs)):
        if specs[j]["code"] == key:
            return specs[j]["start"]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", default=SEED)
    ap.add_argument("--tracks", default=os.path.join(ROOT, "public", "tracks.json"))
    ap.add_argument("--app", default=APP_BASELINE,
                    help="官方 App 路线快照（外部权威基准）；传空字符串跳过")
    ap.add_argument("--geom-tol-km", type=float, default=1.5,
                    help="轨迹端点与官方地点坐标的距离超过它就打问号（地点坐标本身是近似值，只做粗筛）")
    args = ap.parse_args()

    places, specs, gps, names = parse_seed(args.seed)
    tracks = json.load(open(args.tracks, encoding="utf-8")) if os.path.exists(args.tracks) else {}

    # 先跟**外部权威基准**对一遍（里程/编号是否漏），再查内部几何
    app_issues = check_app(places, specs, names, args.app)

    print("=" * 118)
    print("官方口径（seed.ts SPECS） × 实际几何（tracks.json）逐条对账")
    print("=" * 118)
    print(f"{'编号':<6}{'起点':<16}{'终点':<16}{'官方km':>8} | "
          f"{'轨迹km':>8}{'偏差':>8}{'判定':>6} {'爬升m':>6} {'段':>3}  端点判据")

    problems, missing = [], []
    tot_off = 0.0
    for i, sp in enumerate(specs):
        code, okm = sp["code"], sp["km"]
        s_zh = f"{sp['start']}"
        e_zh = f"{sp['end']}"
        ent = tracks.get(code)
        if not ent:
            missing.append(code)
            print(f"{code:<6}{s_zh:<16}{e_zh:<16}{okm:>8.1f} | "
                  f"{'—':>8}{'—':>8}{'无轨迹':>6} {'—':>6} {'—':>3}  ——")
            continue

        lines = track_lines(ent)
        tkm = None
        if lines:
            tkm = sum(F.path_len_m(l) for l in lines) / 1000
        else:
            tkm = float(ent.get("km") or 0.0)
        tot_off += tkm

        diff = tkm - okm
        pct = diff / okm * 100.0 if okm else 0.0
        if abs(pct) <= OK_PCT:
            mark = "✅"
        elif abs(pct) <= WARN_PCT:
            mark = "⚠️"
        else:
            mark = "⛔"

        gain = ent.get("gainM")
        nseg = len(lines) if lines else 1

        # 端点判据：**只用标了「// 官方 GPS」的地点**。
        # 其余 PLACES 是近似坐标（偏差可达 10km），拿它算出来的「离官方 7~13km」全是假警报，
        # 会把真正的问题（07 的 3.7km）淹掉 —— 所以这里宁可不判，也不给假数字。
        hint, end_bad = "近似坐标·不作判据", False
        if lines:
            a, b = lines[0][0], lines[-1][-1]
            if sp["start"] in gps and sp["end"] in gps:
                pa, pb = places[sp["start"]], places[sp["end"]]
                da = F.haversine_m(a, pa) / 1000.0
                db = F.haversine_m(b, pb) / 1000.0
                dai = F.haversine_m(a, pb) / 1000.0
                dbi = F.haversine_m(b, pa) / 1000.0
                fwd, rev = da + db, dai + dbi
                if rev < fwd:
                    hint = f"❌ 方向反了（反向 {rev:.1f} < 正向 {fwd:.1f}）"
                    end_bad = True
                else:
                    worst = max(da, db)
                    if worst > args.geom_tol_km:
                        hint = f"❌ 端点对不上（最近 {worst:.1f}km）"
                        end_bad = True
                    else:
                        hint = f"官方GPS ✅（端点 ≤{worst:.1f}km）"

        note = ""
        if mark != "✅":
            note = f"  ← {diff:+.2f}km ({pct:+.1f}%)"
        print(f"{code:<6}{s_zh:<16}{e_zh:<16}{okm:>8.1f} | "
              f"{tkm:>8.2f}{diff:>+8.2f}{mark:>6} {str(gain):>6} {nseg:>3}  {hint}{note}")

        if mark != "✅" or end_bad:
            problems.append((code, okm, tkm, pct, nseg, hint))

    print("-" * 118)
    print(f"{len(specs)} 条官方路线；有轨迹 {len(specs) - len(missing)} 条，缺轨迹 {len(missing)} 条")
    if missing:
        print(f"  缺轨迹：{'、'.join(missing)}（页面上走近似坐标连成的虚线，标注「暂无实测轨迹」）")
    if problems:
        print(f"\n需要复核的 {len(problems)} 条：")
        for code, okm, tkm, pct, nseg, hint in sorted(problems, key=lambda x: -abs(x[3])):
            print(f"  {code:<6} 官方 {okm:>5.1f} / 轨迹 {tkm:>5.2f}  ({pct:+.1f}%)  段={nseg}  {hint}")
    else:
        print("\n所有有轨迹的编号都在 ±5% 以内 ✅")

    # 合计里程口径
    tot_official = sum(s["km"] for s in specs)
    print(f"\n官方逐条合计 {tot_official:.1f} km  ／ 有轨迹部分合计 {tot_off:.1f} km")


if __name__ == "__main__":
    main()
