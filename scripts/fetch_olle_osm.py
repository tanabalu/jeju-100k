#!/usr/bin/env python3
"""从 OpenStreetMap 抓取偶来小路各条路线的**真实走向**，导出 GeoJSON 给 import_tracks.py 用。

为什么走 OSM，而不是别的地方：
  官方 jejuolle.org 只公布每条线的**起点/终点 GPS 坐标**（例如 7-1 线
  33.249104,126.508588 → 33.247461,126.558717），拿不到中间怎么走 —— 用它只能画出
  一根直线，跟现在的问题一模一样。
  而 OSM 里部分偶来小路建了 `route=hiking` 的 route relation，成员就是实际步道
  （footway / path / 村道）的 way。**把成员 way 缝起来，就是一条能照着走的轨迹。**

用法：
    python3 scripts/fetch_olle_osm.py                    # 全量抓取并导出
    python3 scripts/fetch_olle_osm.py --dry              # 只报告覆盖情况，不写文件
    python3 scripts/fetch_olle_osm.py --only 01 07-1     # 只抓这几条（排查用）
    python3 scripts/fetch_olle_osm.py --alias 03-A=03    # OSM 里的变体编号映射到你的编号
    python3 scripts/fetch_olle_osm.py --endpoint https://overpass.kumi.systems/api/interpreter
    python3 scripts/fetch_olle_osm.py --dump-raw raw.json # 存原始响应，便于离线排查

产出 tracks/osm/olle-<编号>.geojson，接着跑：
    python3 scripts/import_tracks.py --src tracks/osm --elevation

## 缝合算法（这里最容易出错，改之前先读）

关系里的 way 是**无序集合**，不是按行程排好的数组。所以不能「按成员顺序连」：
  1. **连接判据看「任意节点」，不是只看端点**。一条长 way 的中途节点常被别的 way 接上
     （way B 的首节点落在 way A 的中间）。只比端点会把它误判成断口，
     于是图上凭空多出一段跳线 —— 而且实走里程看起来还正常，极难发现。
  2. **岔路口按「直行优先」选下一段**：同时有多条 way 接得上时，选转角最小的那条。
     偶来各条线大量交叉共享路径，「先到先得」会把线带到别的路上去。
  3. **中途命中就地把 way 劈开**：取继续往前走的那一半，另一半放回池子（标记为支线，
     只在没有其它候选时才用）。
  4. **不许做全局最近邻**：环线/交叉路口会被带偏，拼出一条来回折返的线。
  5. 接不上就**收尾、从池子里另起一段**（不是硬连一条直线）。段与段之间就是 OSM
     真没画的地方，导出成 MultiLineString，前端画出来是有缺口的折线 —— 不伪造。

⚠️ 两个诚实的边界：
1. **OSM 是众包数据，覆盖不全**：本脚本会打印「拿到几条 / 还差几条」。缺的那几条
   OSM 根本没建关系，跟脚本无关，得换源（见 README 的「轨迹从哪来」）。
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

# 同一个节点判定阈值：OSM 共享节点坐标完全一致，1e-7 度 ≈ 1.1 cm 足够
NODE_ND = 7
# 接不上时允许「就近接上」的距离（OSM 少画了很短一段的情况）
JOIN_TOL_M = 60.0
# 断口占「实走 + 断口」的比例超过它，形状就不可信了，默认不导出
MAX_GAP_FRAC = 0.35
# 实走里程 / 官方里程 低于它，说明这条关系只画了一部分，默认不导出
MIN_COVERAGE = 0.60

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

# 没带编号但能对上号的别名（关系名里没有数字，靠关键字认）
NAME_ALIAS = {
    "우도올레": "01-1",       # 牛岛
    "가파도올레": "10-1",     # 加波岛
    "추자도올레": "18-1",     # 楮子岛（上）
}


def build_query(with_children=True):
    s, w, n, e = BBOX
    box = f"{s},{w},{n},{e}"
    # type 要同时收 route 与 superroute：有的线被拆成「父关系 + 子关系」，
    # 父关系是 superroute，只查 type=route 会整条漏掉。
    sel = [
        f'["name"~"올레",i]',
        f'["name"~"Olle",i]',
        f'["name:en"~"Olle",i]',
        f'["ref"~"올레|Olle",i]',
        f'["network"~"올레|Olle",i]',
    ]
    union = "\n".join(
        f'  rel({box})["type"~"^(route|superroute)$"]["route"~"^(hiking|foot|walking)$"]{s};'
        for s in sel
    )
    q = (
        "[out:json][timeout:600];\n"
        "(\n"
        f"{union}\n"
        ")->.r;\n"
        # 父关系自身的成员几何
        ".r out geom;\n"
    )
    if with_children:
        # 子关系单独取一次：superroute 的成员是子关系，而 `out geom` **不会递归**，
        # 漏了这句，被拆分的线会整段消失（表现：里程偏短 + 断口巨大）
        q += "rel(br.r) out geom;\n"
    return q


class QueryRejected(Exception):
    """Overpass 认为查询本身有问题（HTTP 400）—— 语法或范围不合它胃口"""


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
            with urllib.request.urlopen(req, timeout=300) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            last = f"HTTP {err.code}"
            if err.code == 400:
                # 语法被拒：交给调用方降级重试（换更保守的查询），别直接判死
                raise QueryRejected(last)
            hint = ""
            if err.code in (429, 504):
                hint = "（限流/超时，可换 --endpoint 镜像）"
            print(f"  第 {attempt + 1} 次失败：{last}{hint}", file=sys.stderr)
            time.sleep(10 * (attempt + 1))
            continue
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
    for kw, code in NAME_ALIAS.items():
        if kw in name:
            return code
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


def index_relations(elements):
    return {e["id"]: e for e in elements if e.get("type") == "relation"}


def ways_of(rel, rel_index=None, _seen=None):
    """取出关系下所有 way 的几何。

    递归展开子关系（superroute / 被拆分的线），按 way id 去重。
    返回 [{'id': way_id, 'role': role, 'pts': [(lng, lat), ...]}]
    """
    rel_index = rel_index or {}
    _seen = _seen if _seen is not None else set()
    if rel.get("id") in _seen:
        return []
    _seen.add(rel.get("id"))

    out, seen_ways = [], set()
    for m in rel.get("members") or []:
        mtype = m.get("type")
        if mtype == "relation" and rel_index:
            child = rel_index.get(m.get("ref"))
            if child is not None:
                for w in ways_of(child, rel_index, _seen):
                    if w["id"] not in seen_ways:
                        seen_ways.add(w["id"])
                        out.append(w)
            continue
        if mtype != "way":
            continue
        pts = [
            (float(p["lon"]), float(p["lat"]))
            for p in (m.get("geometry") or [])
            if isinstance(p, dict) and "lon" in p and "lat" in p
        ]
        if len(pts) < 2:
            continue
        if m.get("role") == "backward":
            pts = pts[::-1]
        wid = m.get("ref")
        if wid in seen_ways:
            continue
        seen_ways.add(wid)
        out.append({"id": wid, "role": m.get("role") or "", "pts": pts})
    return out


def members_summary(rel, rel_index=None):
    """关系成员构成，用来判断「断口」到底是数据缺失还是取数据取漏了。

    rel 计数很关键：成员是子关系时 `out geom` 不会带几何，必须单独抓，
    否则整段消失 —— 表现就是「实走里程偏短 + 断口巨大」。
    role_txt 只在**有非空 role** 时返回内容（全是空 role 是常态，不必刷屏）。
    """
    kinds = {"way": 0, "rel": 0, "node": 0}
    roles = {}
    for m in rel.get("members") or []:
        t = m.get("type")
        kinds[t] = kinds.get(t, 0) + 1
        if t == "way":
            r = m.get("role") or ""
            if r:
                roles[r] = roles.get(r, 0) + 1
    role_txt = "、".join(f"{k}×{v}" for k, v in sorted(roles.items()))
    return kinds, role_txt


def _key(p, nd=NODE_ND):
    return (round(p[0], nd), round(p[1], nd))


def _bearing(a, b):
    """a→b 的方位角（度，0=正北，顺时针）"""
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    dlng = math.radians(b[0] - a[0])
    y = math.sin(dlng) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlng)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def _turn_deg(in_dir, out_dir):
    """从 in_dir 转到 out_dir 的转角（0~180，0=直行）"""
    return abs((out_dir - in_dir + 180.0) % 360.0 - 180.0)


def _turn_to(in_dir, tail, nxt):
    """走到 tail、再迈向 nxt 时的转角；没有来时方向就当作直行"""
    return 0.0 if in_dir is None else _turn_deg(in_dir, _bearing(tail, nxt))


def _incoming_dir(seg, back_m=25.0):
    """用末尾往回找 ≥back_m 米的一个点估「来时方向」，避免密采样下抖动"""
    tail = seg[-1]
    for p in reversed(seg[:-1]):
        if haversine_m(p, tail) >= back_m:
            return _bearing(p, tail)
    if len(seg) >= 2:
        return _bearing(seg[-2], tail)
    return None


def _endpoint_degree(pool):
    """端点节点 → 有几条 way 以它为端点。度数 1 = 真正的线头（从它起头最稳）"""
    deg = {}
    for w in pool:
        for p in (w["pts"][0], w["pts"][-1]):
            k = _key(p)
            deg[k] = deg.get(k, 0) + 1
    return deg


def _splice(seg, w2, hit, step, forward, pool, stats):
    """把命中的 way 接进 seg：forward=True 接在尾部，False 插到头部。

    `hit` 是**命中节点在 w2 里的下标**（也就是要连上的那个点）。
    命中落在 w2 中间时，把 w2 就地劈开，另一半（支线）放回池子 —— 只当兜底候选，
    因为路线既然是从中间穿过去的，另一半本来就不属于这条线。
    """
    pts = w2["pts"]
    last = len(pts) - 1
    if step > 0:
        cont, left = pts[hit:], pts[: hit + 1]
    else:
        cont, left = pts[: hit + 1][::-1], pts[hit:][::-1]
    if 0 < hit < last:
        stats["split"] += 1
        if len(left) >= 2:
            pool.append({"id": w2["id"], "role": w2["role"], "pts": left, "spur": True})
    if forward:
        return seg + cont[1:]
    # 往前接：cont 的末尾就是锚点，倒过来后去掉重复的锚点插到头部
    return cont[::-1][:-1] + seg


def _grow(seg, pool, forward, join_tol, stats):
    """从 seg 的一端一路接下去：forward=True 接尾部（向后走），False 接头部（向前走）。

    候选排序：① 节点级命中优先于「就近接上」；② 同档里**直行优先**（转角最小）——
    偶来各条线大量交叉共享路径，不按直行选会顺着岔路跑到别的线上去；
    ③ 再同档才看是不是支线。
    """
    while True:
        anchor = seg[-1] if forward else seg[0]
        k = _key(anchor)
        in_dir = _incoming_dir(seg) if forward else _incoming_dir(seg[::-1])
        cands = []
        for wi, w2 in enumerate(pool):
            pts = w2["pts"]
            last = len(pts) - 1
            hit = next((pi for pi, p in enumerate(pts) if _key(p) == k), None)
            if hit is not None:
                # 首选：节点级命中 —— OSM 共享节点坐标必然完全一致，可信度最高
                for step in (1, -1):
                    ni = hit + step
                    if 0 <= ni <= last:
                        cands.append((0, _turn_to(in_dir, anchor, pts[ni]), wi, hit, step, w2["spur"]))
                continue
            # 退一步：端点落在容差内（OSM 里少画了几米、两边没共享节点）
            for pi, step in ((0, 1), (last, -1)):
                if haversine_m(anchor, pts[pi]) > join_tol:
                    continue
                ni = pi + step
                if 0 <= ni <= last:
                    cands.append((1, _turn_to(in_dir, anchor, pts[ni]), wi, pi, step, w2["spur"]))
        if not cands:
            return seg
        cands.sort(key=lambda c: (c[0], c[1], c[5]))
        if len(cands) > 1:
            stats["junction"] += 1
        if cands[0][1] > 150:
            stats["backtrack"] += 1
        tier, _, wi, hit, step, _ = cands[0]
        w2 = pool.pop(wi)
        if tier == 1:
            stats["near"] += 1
            stats["nearM"] += haversine_m(anchor, w2["pts"][hit])
        seg = _splice(seg, w2, hit, step, forward, pool, stats)


def join_ways(ways, join_tol=JOIN_TOL_M):
    """把无序的 way 集合缝成尽量连续的分段折线（算法说明见模块 docstring）。

    返回 (segments, gaps, stats)：
      segments — 分段折线 [[(lng, lat), ...], ...]；段与段之间是 OSM 真没画的地方，
                 **不要连线**，前端按多段绘制会自然留出缺口
      gaps     — [{'m': 断口米数, 'from': [lng, lat], 'to': [lng, lat]}]，供报告用
      stats    — 诊断计数（岔路口、中途劈开、直行胜出等）
    """
    pool = [
        {"id": w.get("id"), "role": w.get("role", ""), "pts": list(w["pts"]), "spur": False}
        for w in ways
        if len(w.get("pts") or []) >= 2
    ]
    if not pool:
        return [], [], {"ways": 0, "segments": 0, "junction": 0, "split": 0,
                        "backtrack": 0, "near": 0, "nearM": 0.0, "spurDropped": 0.0}

    stats = {"ways": len(pool), "junction": 0, "split": 0, "backtrack": 0,
             "near": 0, "nearM": 0.0, "spurDropped": 0.0}
    segments, seg_spur = [], []

    while pool:
        # 起头：优先挑「有一端在池子里只出现一次」的 way（真正的线头），别从中间开始
        deg = _endpoint_degree(pool)
        seed_i = 0
        for i, w in enumerate(pool):
            if w["spur"]:
                continue
            if deg.get(_key(w["pts"][0]), 0) <= 1 or deg.get(_key(w["pts"][-1]), 0) <= 1:
                seed_i = i
                break
        w = pool.pop(seed_i)
        seg = list(w["pts"])
        # 让前进方向从「度数 1」的那端出发
        if deg.get(_key(seg[0]), 0) > deg.get(_key(seg[-1]), 0):
            seg.reverse()
        # ⚠️ 两个方向都要长：起头那条 way 常常是**中途**被挑出来的（比如它有一端
        #    正好度数 1，但其实前面还接着一段）。只往后接会把完整的一条线拆成两段。
        seg = _grow(seg, pool, True, join_tol, stats)
        seg = _grow(seg, pool, False, join_tol, stats)

        if len(seg) >= 2:
            segments.append(seg)
            seg_spur.append(bool(w["spur"]))

    # 支线（中途劈开后留下的那一半）放回池子只是给「后面还会不会接上」留机会；
    # 到最后还没被用上，就说明它确实不属于这条线 —— 丢掉，别当成独立线段画出来，
    # 否则地图上会多出一条跟路线无关的碎线。
    kept, dropped_m = [], 0.0
    for s, sp in zip(segments, seg_spur):
        if sp:
            dropped_m += path_len_m(s)
            continue
        kept.append(s)
    segments = kept
    stats["spurDropped"] = dropped_m

    # 断口 = 相邻两段之间最近的「端点对」距离（段顺序本身不代表行程顺序）
    gaps = []
    for a, b in zip(segments, segments[1:]):
        options = [
            (haversine_m(a[-1], b[0]), a[-1], b[0]),
            (haversine_m(a[-1], b[-1]), a[-1], b[-1]),
            (haversine_m(a[0], b[0]), a[0], b[0]),
            (haversine_m(a[0], b[-1]), a[0], b[-1]),
        ]
        d, p1, p2 = min(options, key=lambda o: o[0])
        gaps.append({"m": d, "from": list(p1), "to": list(p2)})

    stats["segments"] = len(segments)
    return segments, gaps, stats


def geojson_for(code, rel, segments, gaps, km):
    gap_m = sum(g["m"] for g in gaps)
    official = OFFICIAL_KM.get(code)
    coords = [[[round(x, 7), round(y, 7)] for x, y in seg] for seg in segments]
    geometry = (
        {"type": "MultiLineString", "coordinates": coords}
        if len(coords) > 1
        else {"type": "LineString", "coordinates": coords[0]}
    )
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
                    "segments": len(coords),
                    "gaps": len(gaps),
                    "gapM": round(gap_m, 1),
                    "km": round(km, 2),
                    "officialKm": official,
                    "coverage": round(km / official, 3) if official else None,
                },
                "geometry": geometry,
            }
        ],
    }


def verdict_of(km, gap_m, official, min_cov=MIN_COVERAGE, max_frac=MAX_GAP_FRAC):
    """给一行数据下判定：✅ 可用 / ⚠️ 有缺段 / ⛔ 太零碎"""
    walk_m = km * 1000
    frac = gap_m / (walk_m + gap_m) if (walk_m + gap_m) > 0 else 0.0
    cov = (km / official) if official else None
    bad = []
    if cov is not None and cov < min_cov:
        bad.append(f"只画到 {cov * 100:.0f}%")
    if frac > max_frac:
        bad.append(f"断口占 {frac * 100:.0f}%")
    if bad:
        return "⛔", "、".join(bad)
    if frac > 0.05 or (cov is not None and abs(cov - 1) > 0.15):
        return "⚠️", f"断口 {frac * 100:.0f}%" + (f"、覆盖 {cov * 100:.0f}%" if cov else "")
    return "✅", ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    ap.add_argument("--out-dir", default=os.path.join(ROOT, "tracks", "osm"))
    ap.add_argument("--only", nargs="+", default=[], help="只处理这些编号")
    ap.add_argument("--alias", action="append", default=[],
                    help="OSM 编号=你的编号，如 03-A=03 / 15-B=15")
    ap.add_argument("--join-tol", type=float, default=JOIN_TOL_M,
                    help="接不上时允许就近接上的距离（米）")
    ap.add_argument("--min-coverage", type=float, default=MIN_COVERAGE,
                    help="实走里程/官方里程 低于它就判定不可用")
    ap.add_argument("--max-gap-frac", type=float, default=MAX_GAP_FRAC,
                    help="断口占比高于它就判定不可用")
    ap.add_argument("--keep-bad", action="store_true",
                    help="判定 ⛔ 的也照样导出（默认跳过，避免半条线冒充整条）")
    ap.add_argument("--dump-raw", help="把 Overpass 原始响应存到这个文件（离线排查用）")
    ap.add_argument("--dry", action="store_true", help="只报告，不写文件")
    args = ap.parse_args()

    alias = dict(a.split("=", 1) for a in args.alias if "=" in a)

    print(f"查询 Overpass：{args.endpoint}")
    print(f"范围 {BBOX}，匹配 name/ref/network 含「올레」或「Olle」的 route 关系\n")
    try:
        data = overpass(args.endpoint, build_query(with_children=True))
    except QueryRejected as err:
        # 降级：去掉 `rel(br.r)` 再试一次。取不全总比整跑挂掉强，但要明说。
        print(f"⚠️ Overpass 拒绝了带子关系的查询（{err}），去掉子关系那一步重试。")
        print("   → 被拆成「父关系 + 子关系」的线这次可能取不全，"
              "报表里会表现成「里程偏短 + 断口很大」，别当成数据本身缺失。\n")
        data = overpass(args.endpoint, build_query(with_children=False))
    if args.dump_raw:
        with open(args.dump_raw, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        print(f"原始响应已存：{args.dump_raw}")

    remark = data.get("remark")
    if remark:
        print(f"⚠️ Overpass 说：{remark}")
        print("   这条常常意味着**结果被截断**（超时/超内存），第一次的数据不可全信，")
        print("   换个 --endpoint 镜像或缩小 --only 范围重跑。\n")

    rel_index = index_relations(data.get("elements", []))
    rels = [e for e in data.get("elements", []) if e.get("type") == "relation"]
    # ⚠️ 子关系（被别的返回关系当作成员引用的）**不能单独当候选**：
    #    它的几何已经并进父关系了，再单独算一遍 → 表里同一个编号出现两行，
    #    而且它里程更短，会跟父关系抢「哪个覆盖更好」。
    child_ids = {
        m.get("ref")
        for r in rels
        for m in (r.get("members") or [])
        if m.get("type") == "relation"
    }
    parents = [r for r in rels if r.get("id") not in child_ids]
    children = [r for r in rels if r.get("id") in child_ids]
    print(
        f"取回 {len(rels)} 个关系（{len(parents)} 个顶层 + {len(children)} 个子关系；"
        "子关系已并入父关系，不单独算一条）\n"
    )

    # 同名关系可能重复（3코스 有 A/B 变体、有的线拆成两段），先全部解析再归并
    parsed = []
    for rel in parents:
        tags = rel.get("tags") or {}
        raw = code_from_name(tags.get("name") or tags.get("name:en") or "")
        code = alias.get(raw, raw)
        parsed.append((rel, tags, raw, code))

    if args.only:
        want = set(args.only)
        parsed = [p for p in parsed if p[2] in want or p[3] in want]

    print(f"{'OSM编号':<8} {'归到':<6} {'way':>4} {'点':>5} {'段':>3} "
          f"{'实走km':>7} {'覆盖':>6} {'断口':>9} {'判定':<4} 名称")
    print("-" * 112)
    out, unmatched, notes, skipped, winners = {}, [], [], [], {}
    for rel, tags, raw, code in sorted(parsed, key=lambda p: (p[3] or "zz", p[2] or "")):
        name = tags.get("name") or tags.get("name:en") or f"relation {rel['id']}"
        kinds, role_txt = members_summary(rel, rel_index)
        way_list = ways_of(rel, rel_index)
        segments, gaps, stats = join_ways(way_list, args.join_tol)
        walk_m = sum(path_len_m(s) for s in segments)
        gap_m = sum(g["m"] for g in gaps)
        km = walk_m / 1000
        off = OFFICIAL_KM.get(code) if code else None
        cov = (km / off) if off else None
        if code and code in ROUTE_CODES:
            mark, why = verdict_of(km, gap_m, off, args.min_coverage, args.max_gap_frac)
        else:
            # 编号不在这 27 条里 → 不判定，避免显示出「✅ 可用」却又进不了产物
            mark, why = "—", ""
        n_pts = sum(len(s) for s in segments)
        gap_col = f"{len(gaps)}/{gap_m / 1000:.1f}km" if gaps else "—"
        print(
            f"{raw or '—':<8} {code or '—':<6} {len(way_list):>4} {n_pts:>5} "
            f"{len(segments):>3} {km:>7.2f} {(f'{cov * 100:.0f}%' if cov else '—'):>6} "
            f"{gap_col:>9} {mark:<4} {name}"
        )
        # 成员构成里藏着关键线索：子关系没展开 → 里程会明显偏短
        detail = []
        if kinds["rel"]:
            detail.append(f"成员含子关系 {kinds['rel']} 个（已展开）")
        if kinds["node"]:
            detail.append(f"成员含节点 {kinds['node']} 个")
        if role_txt:
            detail.append(f"role {role_txt}")
        extra = []
        if stats["split"]:
            extra.append(f"中途劈开 {stats['split']}")
        if stats["junction"]:
            extra.append(f"岔路 {stats['junction']}")
        if stats["backtrack"]:
            extra.append(f"掉头 {stats['backtrack']}")
        if stats["near"]:
            extra.append(f"就近接上 {stats['near']} 处/共 {stats['nearM']:.0f}m")
        if stats["spurDropped"]:
            extra.append(f"丢弃支线 {stats['spurDropped'] / 1000:.2f}km")
        if detail or extra:
            notes.append(f"{raw or '—'}: " + "，".join(detail + extra))
        if len(gaps) > 1:
            worst = sorted(gaps, key=lambda g: -g["m"])[:3]
            notes.append(
                f"{raw or '—'}: 最大的几个断口 —— "
                + "；".join(f"{g['m'] / 1000:.2f}km @ {g['from'][1]:.4f},{g['from'][0]:.4f}" for g in worst)
            )

        if not code:
            unmatched.append(name)
            continue
        if code not in ROUTE_CODES:
            unmatched.append(f"{name}（推出 {raw}，不在 27 条里；要用就 --alias {raw}={ROUTE_CODES[0]} 之类显式指定）")
            continue

        # 同一编号有多个关系：**留覆盖最好的那条**，不是留最长的
        # （变体/拆段时最长的那条往往缺口也最多）
        cand = (km, -gap_m, rel, segments, gaps)
        if code in winners:
            prev = winners[code]
            prev_cov = min(prev[0] / off, 1.5) if off else 0
            this_cov = min(km / off, 1.5) if off else 0
            if (this_cov, -gap_m) <= (prev_cov, prev[1]):
                notes.append(f"{code}: {raw} 与已有关系同名，留覆盖更好的那条")
                continue
            notes.append(f"{code}: {raw} 覆盖更好（{km:.1f}km），替换掉之前那条")
            skipped[:] = [s for s in skipped if not s.startswith(f"{code} ")]
        winners[code] = cand

        if mark == "⛔" and not args.keep_bad:
            skipped.append(f"{code} （{why}，OSM 这条关系只画了一部分，保持原样更诚实）")
            continue
        out[code] = geojson_for(code, rel, segments, gaps, km)
        if mark == "⚠️":
            notes.append(f"{code} 已导出但请留意：{why}")

    print()
    got = [c for c in ROUTE_CODES if c in out]
    missing = [c for c in ROUTE_CODES if c not in out]
    print(f"拿到 {len(got)}/{len(ROUTE_CODES)} 条：{'、'.join(got) if got else '（无）'}")
    if skipped:
        print("\n⛔ 判定不可用、没有导出（保持原来的近似坐标，不要用半条线冒充整条）：")
        for s in skipped:
            print(f"  - {s}")
    if missing:
        print(f"\n还差：{'、'.join(missing)}")
        print("  · 上表里根本没出现的编号 = OSM 没建关系（不是脚本问题），要换数据源；")
        print("  · 出现了但「归到 —」= 名字认不出，用 --alias 手工映射。")
    if unmatched:
        print("\n没归到编号的关系：")
        for u in unmatched:
            print(f"  - {u}")
    if children:
        names = [(c.get("tags") or {}).get("name") or f"relation {c['id']}" for c in children]
        shown = "、".join(names[:5]) + ("…" if len(names) > 5 else "")
        notes.append(f"并入父关系的子关系 {len(children)} 个：{shown}")
    if notes:
        print("\n诊断（判断断口是「数据缺失」还是「缝合失误」看这里）：")
        for s in dict.fromkeys(notes):
            print(f"  - {s}")

    if args.dry:
        print("\n--dry：未写文件。")
        return
    if not out:
        sys.exit("\n一条都没导出，先处理上面的问题（通常是 --alias 或网络）。")

    os.makedirs(args.out_dir, exist_ok=True)
    # 清理上一次跑剩下的（编号变了不会留下孤儿文件）
    for old in os.listdir(args.out_dir):
        if old.startswith("olle-") and old.endswith(".geojson"):
            os.remove(os.path.join(args.out_dir, old))
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
