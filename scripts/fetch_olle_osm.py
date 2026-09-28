#!/usr/bin/env python3
"""从 OpenStreetMap 抓取偶来小路各条路线的**真实走向**，导出 GeoJSON 给 import_tracks.py 用。

为什么走 OSM，而不是别的地方：
  官方 jejuolle.org 只公布每条线的**起点/终点 GPS 坐标**（例如 7-1 线
  33.249104,126.508588 → 33.247461,126.558717），拿不到中间怎么走 —— 用它只能画出
  一根直线，跟现在的问题一模一样。
  而 OSM 里每条偶来小路都建了 `route=hiking` 的 route relation（例：올레길 19코스 =
  relation 9173551，79 个成员 way，被一个父 relation 串起来），成员就是实际步道
  （footway / path / 村道）的 way。**按成员顺序拼起来，就是一条能照着走的轨迹。**

用法：
    python3 scripts/fetch_olle_osm.py                    # 全量抓取并导出
    python3 scripts/fetch_olle_osm.py --dry              # 只报告覆盖情况，不写文件
    python3 scripts/fetch_olle_osm.py --only 01 07-1     # 只抓这几条（排查用）
    python3 scripts/fetch_olle_osm.py --alias 03-A=03    # OSM 里的变体编号映射到你的编号
    python3 scripts/fetch_olle_osm.py --endpoint https://overpass.kumi.systems/api/interpreter

产出 tracks/osm/olle-<编号>.geojson，接着跑：
    python3 scripts/import_tracks.py --src tracks/osm --elevation

⚠️ 两个诚实的边界：
1. **OSM 是众包数据**，走向大体准确（都是照着指示带走过的），但个别路段可能没画完、
   或最近的改线还没同步。脚本会打印「拼接断口数 / 断口总长 / 与官方里程的差」，
   断口多或里程差 >25% 的线要人工看一眼再定。
2. OSM 的 way 上**没有海拔**，所以本脚本只管走向；海拔交给 import_tracks.py 的
   `--elevation`（opentopodata 的 SRTM 30m）补。
"""

import argparse
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 复用导入脚本里那套「官方编号 + 官方里程 + 球面距离」，避免两处口径漂移
from import_tracks import OFFICIAL_KM, ROUTE_CODES, haversine_m, path_len_m  # noqa: E402

DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter"
# 主站限流/维护时的镜像（--endpoint 指定，或全挂时脚本会提示）
MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
]

# 济州本岛 + 牛岛 + 加波岛 + 楮子岛都落在这个框里
BBOX = (33.00, 126.10, 34.00, 127.00)  # south, west, north, east

# 「拼接断口」容忍距离：相邻 way 理论上是共享节点的，坐标一致；留 60 m 容纳
# OSM 里少画了一小段的情况。超过就计入断口，报告里提示人工看。
GAP_TOL_M = 60.0
# 同一个点判定为「已连接」的距离（共享节点换算成经纬度后会有极小误差）
JOIN_EPS_M = 1.0
# 断口总长超过它的路线**直接不导出**。因为拼接时断口处只能用一条直线硬连，
# 万一 OSM 少画了半条线，图上就会出现一根横穿的假线 —— 宁可这条线保持「近似」，
# 也不能给它一条编出来的轨迹。
MAX_GAP_M = 500.0

# 올레길 / 제주올레 / Jeju Olle Trail 后面的编号；允许 1 / 01 / 1-1 / 3-A / 3(A) 这些写法。
# ⚠️ 后面的字母后缀必须整体可选，否则「올레길 19코스」这种最普通的写法会匹配失败；
#    而字母又必须紧跟在数字/코스 之后且不能是单词的一部分（(?![A-Za-z])），
#    否则「올레길 19코스(Jeju)」会把 J 当成变体编号。
CODE_RE = re.compile(
    r"(?:올레\s*길?|Olle\s*(?:Trail|Route|Gil))\s*"
    r"(\d{1,2}(?:\s*[-–]\s*\d{1,2})?)"
    r"\s*(?:코스|course)?"
    r"(?:\s*(?:[-–]\s*|\(\s*)([A-Za-z])(?![A-Za-z])\s*\)?)?",
    re.I,
)


def build_query():
    s, w, n, e = BBOX
    box = f"{s},{w},{n},{e}"
    return (
        "[out:json][timeout:300];\n"
        "(\n"
        f'  rel({box})["type"="route"]["route"~"^(hiking|foot|walking)$"]["name"~"올레"];\n'
        f'  rel({box})["type"="route"]["route"~"^(hiking|foot|walking)$"]["name"~"Olle",i];\n'
        ");\n"
        "out geom;\n"
    )


def overpass(endpoint, query, retries=3):
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(
            endpoint,
            data=body,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
                # Overpass 明确要求带可识别的 UA，否则可能直接 403
                "User-Agent": "trail-100k/1.0 (jeju olle track fetch; personal project)",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            last = f"HTTP {err.code}"
            hint = ""
            if err.code in (429, 504):
                hint = "（限流/超时，可换 --endpoint 镜像）"
                print(f"  第 {attempt + 1} 次失败：{last}{hint}", file=sys.stderr)
                time.sleep(10 * (attempt + 1))
                continue
            raise SystemExit(f"Overpass 返回 {last}，终止。")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            last = str(err)
            print(f"  第 {attempt + 1} 次失败：{last}", file=sys.stderr)
            time.sleep(8 * (attempt + 1))
    raise SystemExit(
        f"Overpass 连续 {retries} 次失败（{last}）。\n"
        f"试试换镜像：--endpoint {MIRRORS[1]}\n"
        "也可以先手动在 https://overpass-turbo.eu/ 跑 build_query() 里那段查询，"
        "导出 GeoJSON 后直接喂给 import_tracks.py。"
    )


def code_from_name(name):
    """「올레길 19코스」-> '19'；「올레길 1-1코스」-> '01-1'；「올레길 3코스-A」-> '03-A'"""
    if not name:
        return None
    m = CODE_RE.search(name)
    if not m:
        return None
    base = re.sub(r"\s+", "", m.group(1)).replace("–", "-")
    code = f"{int(base.split('-')[0]):02d}"
    if "-" in base:
        code += "-" + base.split("-", 1)[1]
    if m.group(2):
        code += "-" + m.group(2).upper()
    return code


def ways_of(members):
    """按成员顺序取出 way 的几何；role=backward 的翻过来"""
    out = []
    for m in members or []:
        if m.get("type") != "way":
            continue
        geom = m.get("geometry") or []
        pts = [
            (float(p["lon"]), float(p["lat"]))
            for p in geom
            if isinstance(p, dict) and "lon" in p and "lat" in p
        ]
        if len(pts) < 2:
            continue
        if m.get("role") == "backward":
            pts = pts[::-1]
        out.append(pts)
    return out


def join_ways(ways, gap_tol=GAP_TOL_M):
    """把 way 依次缝成一条折线。

    以**成员顺序**为准（OSM 关系里的顺序就是路线行进顺序），只在顺序接不上时，
    才在剩下的 way 里挑第一个能接上的 —— 不打乱顺序稳定性，也不做全局最近邻
    （全局最近邻在环线/交叉路口会被带偏，拼出一条来回折返的线）。
    """
    if not ways:
        return [], 0, 0.0
    pending = list(ways)
    seq = [pending.pop(0)]
    gaps, gap_m, max_gap = 0, 0.0, 0.0
    while pending:
        tail = seq[-1][-1]

        def d_to(w):
            return min(haversine_m(tail, w[0]), haversine_m(tail, w[-1]))

        pick = 0
        if d_to(pending[0]) > gap_tol:
            for i, w in enumerate(pending):
                if d_to(w) <= gap_tol:
                    pick = i
                    break
            else:
                # 谁也接不上：按顺序取下一个，并记一个断口
                gaps += 1
                d = d_to(pending[0])
                gap_m += d
                max_gap = max(max_gap, d)
                pick = 0
        w = pending.pop(pick)
        seq.append(w if haversine_m(tail, w[0]) <= haversine_m(tail, w[-1]) else w[::-1])

    line = list(seq[0])
    for w in seq[1:]:
        line.extend(w[1:] if haversine_m(line[-1], w[0]) < JOIN_EPS_M else w)
    # 相邻重复点去掉（way 交界处会有）
    out = [line[0]]
    for p in line[1:]:
        if haversine_m(out[-1], p) >= JOIN_EPS_M:
            out.append(p)
    return out, gaps, gap_m


def geojson_for(code, rel, line, gaps, gap_m, km):
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "code": code,
                    "osmRelation": rel.get("id"),
                    "name": (rel.get("tags") or {}).get("name"),
                    "nameEn": (rel.get("tags") or {}).get("name:en"),
                    "source": "OpenStreetMap (ODbL)",
                    "ways": len(ways_of(rel.get("members"))),
                    "gaps": gaps,
                    "gapM": round(gap_m, 1),
                    "km": round(km, 2),
                    "officialKm": OFFICIAL_KM.get(code),
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[round(x, 7), round(y, 7)] for x, y in line],
                },
            }
        ],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    ap.add_argument("--out-dir", default=os.path.join(ROOT, "tracks", "osm"))
    ap.add_argument("--only", nargs="+", default=[], help="只处理这些编号")
    ap.add_argument("--alias", action="append", default=[],
                    help="OSM 编号=你的编号，如 03-A=03 / 15-B=15")
    ap.add_argument("--gap-tol", type=float, default=GAP_TOL_M, help="拼接断口容忍（米）")
    ap.add_argument("--max-gap", type=float, default=MAX_GAP_M,
                    help="断口总长超过它就不导出这条线（避免用直线硬连编出假轨迹）")
    ap.add_argument("--dry", action="store_true", help="只报告，不写文件")
    args = ap.parse_args()

    alias = dict(a.split("=", 1) for a in args.alias if "=" in a)
    query = build_query()

    print(f"查询 Overpass：{args.endpoint}")
    print(f"范围 {BBOX}，匹配 name 含「올레」或「Olle」的 route 关系\n")
    data = overpass(args.endpoint, query)
    rels = [e for e in data.get("elements", []) if e.get("type") == "relation"]
    print(f"取回 {len(rels)} 个候选关系\n")

    # 同名关系可能重复（3코스 有 A/B 变体、有的线拆成两段），先全部解析再归并
    parsed = []
    for rel in rels:
        tags = rel.get("tags") or {}
        raw = code_from_name(tags.get("name") or tags.get("name:en") or "")
        code = alias.get(raw, raw)
        parsed.append((rel, tags, raw, code))

    if args.only:
        want = set(args.only)
        parsed = [p for p in parsed if p[2] in want or p[3] in want]

    print(f"{'OSM编号':<8} {'归到':<7} {'way':>4} {'点':>6} {'实走km':>7} {'官方':>6} {'断口':>7} 名称")
    print("-" * 104)
    out, unmatched, suspicious, skipped = {}, [], [], []
    for rel, tags, raw, code in sorted(parsed, key=lambda p: (p[3] or "zz", p[2] or "")):
        name = tags.get("name") or tags.get("name:en") or f"relation {rel['id']}"
        ways = ways_of(rel.get("members"))
        line, gaps, gap_m = join_ways(ways, args.gap_tol)
        # ⚠️ 拼出来的总长里含「断口处那条硬连的直线」，要扣掉才是真实走向的长度，
        #    否则拿它跟官方里程比会把有缺口的线判成正常。
        total_m = path_len_m(line) if len(line) > 1 else 0.0
        km = max(0.0, (total_m - gap_m) / 1000)
        off = OFFICIAL_KM.get(code) if code else None
        gap_col = f"{gaps}/{gap_m:.0f}m" if gap_m else "—"
        print(
            f"{raw or '—':<8} {code or '—':<7} {len(ways):>4} {len(line):>6} "
            f"{km:>7.2f} {(f'{off:.1f}' if off else '—'):>6} {gap_col:>7} {name}"
        )
        if not code:
            unmatched.append(name)
            continue
        if code not in ROUTE_CODES:
            unmatched.append(f"{name}（推出 {raw}，不在 27 条里；要用就 --alias {raw}={ROUTE_CODES[0]} 之类显式指定）")
            continue
        # 断口太大：宁可这条线保持「近似」，也不给它一条编出来的假轨迹
        if gap_m > args.max_gap:
            skipped.append(f"{code}（断口 {gap_m:.0f}m > {args.max_gap:.0f}m，OSM 里这段可能没画完）")
            continue
        if code in out:
            # 同一编号出现两次（A/B 变体或拆段）：保留实走里程更长的那条，并提示
            prev_km = out[code]["km"]
            if km > prev_km:
                out[code] = geojson_for(code, rel, line, gaps, gap_m, km)
            suspicious.append(f"{code} 有 {raw} 等多个关系，取更长的（{max(km, prev_km):.1f}km），"
                              f"若实为分段请人工合并")
            continue
        out[code] = geojson_for(code, rel, line, gaps, gap_m, km)
        if off and km > 0 and abs(km - off) / off > 0.25:
            suspicious.append(f"{code}（OSM {km:.1f}km vs 官方 {off}km，可能没画完或已改线）")
        if gaps >= 3 or gap_m > 300:
            suspicious.append(f"{code}（{gaps} 处断口，共 {gap_m:.0f}m，可能中间有段落没画）")

    print()
    got = [c for c in ROUTE_CODES if c in out]
    missing = [c for c in ROUTE_CODES if c not in out]
    print(f"拿到 {len(got)}/{len(ROUTE_CODES)} 条：{'、'.join(got) if got else '（无）'}")
    if skipped:
        print(f"\n⛔ 断口太大、拒绝导出（这几条保持原样，不要用编出来的线）：")
        for s in skipped:
            print(f"  - {s}")
    if missing:
        print(f"\n还差：{'、'.join(missing)}")
        print("  1) 先用 --dry 看上面的原始关系名，名字不匹配的加 --alias 手工映射；")
        print("  2) 仍缺的（多半是牛岛 / 加波岛 / 楮子岛几个离岛支线）去 Wikiloc、")
        print("     AllTrails、GPXSee 之类找单条 GPX，直接扔给 import_tracks.py --src。")
    if unmatched:
        print("\n没归到编号的关系：")
        for u in unmatched:
            print(f"  - {u}")
    if suspicious:
        print("\n⚠️ 需要人工看一眼：")
        for s in suspicious:
            print(f"  - {s}")

    if args.dry:
        print("\n--dry：未写文件。")
        return
    if not out:
        sys.exit("\n一条都没导出，先处理上面的问题（通常是 --alias 或网络）。")

    os.makedirs(args.out_dir, exist_ok=True)
    total = 0
    for code, gj in sorted(out.items()):
        path = os.path.join(args.out_dir, f"olle-{code}.geojson")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(gj, f, ensure_ascii=False, separators=(",", ":"))
        total += os.path.getsize(path)
    print(f"\n-> {args.out_dir}/olle-*.geojson（{len(out)} 个文件，共 {total / 1024:.0f} KB）")
    print("接着跑：python3 scripts/import_tracks.py --src tracks/osm --elevation")


if __name__ == "__main__":
    main()
