"""把真实轨迹（GPX / KML / GeoJSON）导入成前端用的 public/tracks.json。

为什么需要它：`src/lib/seed.ts` 的 `PLACES` 是手填的「城镇级近似坐标」，实测偏差
最大 10~13 km（Route 1 起终点真实轨迹 126.89590,33.47720 / 126.92410,33.45180，
表里写的是 126.78330,33.46220 / 126.79000,33.43000），地图上整条线被平移进了内陆，
海拔剖面也是沿那条错线采出来的。本脚本用真实轨迹替掉它。

用法：
  python3 import_tracks.py --src ~/Downloads/jeju-olle-tracks          # 目录里放 *.gpx/*.kml/*.geojson
  python3 import_tracks.py --src a.gpx b.kml c.geojson                 # 也可以直接给文件
  python3 import_tracks.py --src dir --dry                             # 只解析报告，不写文件
  python3 import_tracks.py --src dir --map jeju-olle-1.gpx=01          # 文件名认不出编号时手工指定
  python3 import_tracks.py --src dir --reverse 01                      # 该条轨迹方向反了，翻转
  python3 import_tracks.py --src dir --elevation                       # 轨迹没海拔时联网补（SRTM 30m）
  python3 import_tracks.py --src dir --tolerance 10 --max-points 500   # 调简化力度

从 OSM 取偶来小路走向的话，先跑 scripts/fetch_olle_osm.py 导出 GeoJSON，再：
  python3 import_tracks.py --src tracks/osm --elevation

产出：public/tracks.json
  { "01": { "basis": "track", "km": 15.87, "gainM": 200, ...,
            "points": [[lng, lat, ele], ...] }, ... }

**多条线段（有断口）**：GPX 的多个 `<trkseg>`、KML 的多个 `<coordinates>`、
GeoJSON 的 MultiLineString（OSM 缝合后留下的断口就是这种）都当成**独立线段**：
  - `points` 仍是各段顺序拼起来的一整串（海拔剖面只看它）；
  - 段数 > 1 时额外写 `segments`，前端按段绘制 —— 段与段之间**不连线**，
    OSM 没画的地方就留空，不拿直线糊上去；
  - 里程是各段之和，**爬升逐段累加**（跨段海拔未知，混在一起算会凭空多一截）。

前端怎么用（`src/store/DataContext.tsx`）：
  运行时 fetch 该文件，把 `points` 写进 `route.elevationProfile`、`elevationBasis` 置为
  'track'，有 `segments` 时同时写进 `route.elevationSegments` ——
  地图折线按段画、海拔剖面按 `points`，里程与爬升随即改用真实数据。
  **不落库**：换轨迹只要重跑本脚本，刷新即可，不用清 localStorage。

几个刻意的设计：
- **点要简化**：官方 GPX 一条动辄几千点，直接塞进 JSON 会有好几 MB。用 Douglas–Peucker
  （默认 8 m 容差）压到几百点，肉眼无差别；`--max-points` 还会自动放宽容差兜底。
- **爬升口径与前端一致**：3 m 滞后阈值（与 `src/lib/geo.ts` 的 `ELEV_NOISE_M` 相同），
  否则脚本报的爬升和界面上显示的会对不上。
- **没有海拔的轨迹如实标注**：JSON 里不带 ele，前端会显示「暂缺海拔数据」，
  而不是拿旧的错线剖面冒充。OSM 这类只给走向不给海拔的源，加 `--elevation`
  就会用 opentopodata 的 SRTM 30m 补上（结果带缓存，重跑不重复请求）。
- **方向与编号都要人工可核对**：脚本会打印「文件 → 编号」与「轨迹起终点坐标 + 里程」，
  方向反了用 `--reverse`；认不出编号的会明确列出来，不会瞎猜。
"""

import argparse
import glob
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "tracks.json")

# 官方 27 条（21 主线 + 6 支线）。-1/-2 是支线，不要写成 01.1
ROUTE_CODES = [
    "01", "01-1", "02", "03", "04", "05", "06", "07", "07-1", "08", "09", "10",
    "10-1", "11", "12", "13", "14", "14-1", "15", "16", "17", "18", "18-1",
    "18-2", "19", "20", "21",
]

# 官方公布的里程（km），用于对照轨迹里程是否离谱
OFFICIAL_KM = {
    "01": 15.1, "01-1": 13.2, "02": 14.8, "03": 20.9, "04": 19.0, "05": 13.4,
    "06": 10.1, "07": 12.9, "07-1": 16.7, "08": 18.7, "09": 8.0, "10": 15.6,
    "10-1": 3.6, "11": 17.3, "12": 17.8, "13": 14.0, "14": 19.1, "14-1": 9.2,
    "15": 19.0, "16": 15.7, "17": 18.2, "18": 19.8, "18-1": 10.8, "18-2": 9.7,
    "19": 18.7, "20": 17.6, "21": 10.5,
}

ELEV_NOISE_M = 3.0          # 与 src/lib/geo.ts 的 ELEV_NOISE_M 保持一致
R_EARTH_M = 6371008.8

# 海拔补采样（--elevation）：与 scripts/fetch_elevation.py 用同一个公开数据集，口径一致
ELEV_API = "https://api.opentopodata.org/v1/srtm30m"
ELEV_CHUNK = 100            # 该接口单次最多 100 个位置
ELEV_SLEEP = 2.0            # 免费接口限速，别打太密
ELEV_CACHE = os.path.join(ROOT, "scripts", ".cache", "track-elevation.json")

# 文件名里常见的干扰词（去掉后剩下的数字才是路线编号）
NOISE_WORDS = [
    "jeju", "olle", "olletrail", "trail", "route", "course", "stage",
    "gpx", "kml", "geojson", "track", "tracks", "map", "final", "update",
]


def haversine_m(a, b):
    lng1, lat1 = a[0], a[1]
    lng2, lat2 = b[0], b[1]
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH_M * math.asin(min(1.0, math.sqrt(h)))


def path_len_m(pts):
    return sum(haversine_m(pts[i - 1], pts[i]) for i in range(1, len(pts)))


def gain_loss(eles):
    """累计爬升/下降（m），3 m 滞后阈值 —— 与前端 geo.ts 同口径"""
    gain = loss = 0.0
    ref = eles[0]
    for e in eles[1:]:
        d = e - ref
        if d > ELEV_NOISE_M:
            gain += d
            ref = e
        elif d < -ELEV_NOISE_M:
            loss += -d
            ref = e
    return round(gain), round(loss)


# ---------- 海拔补采样（给只有走向、没有海拔的轨迹用） ----------

def load_elev_cache():
    if os.path.exists(ELEV_CACHE):
        try:
            with open(ELEV_CACHE, encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            pass
    return {}


def save_elev_cache(cache):
    os.makedirs(os.path.dirname(ELEV_CACHE), exist_ok=True)
    with open(ELEV_CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, separators=(",", ":"))


def fill_elevations(pts, cache):
    """给缺海拔的点补高程（SRTM 30m），返回与 pts 等长的列表。

    - 请求**在简化之后**发：先 Douglas–Peucker 压到几百点，请求数少一个数量级，
      而简化只看经纬度、不需要海拔，顺序上互不影响。
    - 缓存按「经度,纬度」做键且跨路线复用：邻接路线共享的路口不会重复查。
    - 用 GET + `lat,lng|lat,lng`（该接口的 POST/JSON 形式会返回 400）。
    - 单点失败保留 None，最后用前一个有效值兜底，保持序列连续。
    """
    keys = [f"{p[0]:.6f},{p[1]:.6f}" for p in pts]
    todo = list(dict.fromkeys(k for k in keys if k not in cache))
    if todo:
        print(f"    补海拔：{len(todo)} 个新点（{len(keys) - len(todo)} 个命中缓存）")
    for i in range(0, len(todo), ELEV_CHUNK):
        chunk = todo[i : i + ELEV_CHUNK]
        loc = "|".join(f"{k.split(',')[1]},{k.split(',')[0]}" for k in chunk)
        url = f"{ELEV_API}?locations={urllib.parse.quote(loc, safe=',|')}"
        data = None
        for attempt in range(4):
            req = urllib.request.Request(
                url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "trail-100k/1.0 (track elevation fill)",
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
            wait = ELEV_SLEEP * (attempt + 1) * 2
            print(f"    第 {attempt + 1} 次失败（{err}），{wait:.0f}s 后重试", file=sys.stderr)
            time.sleep(wait)
            data = None
        if data is None or data.get("status") != "OK":
            print("    连续 4 次失败，本批跳过", file=sys.stderr)
            continue
        for k, r in zip(chunk, data.get("results", [])):
            cache[k] = r.get("elevation")
        if i + ELEV_CHUNK < len(todo):
            time.sleep(ELEV_SLEEP)

    vals = [cache.get(k) for k in keys]
    filled, last = [], None
    for v in vals:
        if isinstance(v, (int, float)):
            last = v
        filled.append(last)
    return filled


# ---------- 解析：GPX / KML / GeoJSON ----------

def _local(tag):
    return tag.rsplit("}", 1)[-1].lower()


def parse_gpx(path):
    """GPX → **分段**折线：每个 <trkseg> 是一段。

    轨迹记录中间的暂停（<trkseg> 之间）不是真的有条断口，但两段的端点可能隔着几公里；
    拼成一条会把直线糊上去，所以按段保留。
    """
    root = ET.parse(path).getroot()

    def pts_of(el):
        out = []
        for child in el:
            if _local(child.tag) not in ("trkpt", "rtept", "wpt"):
                continue
            try:
                lat = float(child.get("lat"))
                lng = float(child.get("lon"))
            except (TypeError, ValueError):
                continue
            ele = None
            for sub in child:
                if _local(sub.tag) == "ele" and sub.text:
                    try:
                        ele = float(sub.text)
                    except ValueError:
                        pass
                    break
            out.append((lng, lat, ele))
        return out

    # 从最精确的一层开始切段：trkseg → trk → rte
    for kind in ("trkseg", "trk", "rte"):
        found = [el for el in root.iter() if _local(el.tag) == kind]
        if kind == "trk":
            # trk 里还有 trkseg 的，交给 trkseg 处理，别重复取
            found = [el for el in found if not any(_local(c.tag) == "trkseg" for c in el)]
        segs = [p for p in (pts_of(el) for el in found) if len(p) >= 2]
        if segs:
            return segs
    one = pts_of(root)
    return [one] if len(one) >= 2 else []


def parse_kml(path):
    """KML → **分段**折线：每个 <coordinates> 块是一段，连续的 gx:coord 合成一段"""
    root = ET.parse(path).getroot()
    segs, gx = [], []

    def flush_gx():
        nonlocal gx
        if len(gx) >= 2:
            segs.append(gx)
        gx = []

    for el in root.iter():
        name = _local(el.tag)
        if name == "coordinates" and el.text:
            flush_gx()
            # "lng,lat,alt lng,lat,alt ..."（也有用换行分隔的）
            pts = []
            for chunk in el.text.replace("\n", " ").replace("\t", " ").split():
                parts = chunk.split(",")
                if len(parts) < 2:
                    continue
                try:
                    lng, lat = float(parts[0]), float(parts[1])
                    ele = float(parts[2]) if len(parts) > 2 and parts[2] else None
                except ValueError:
                    continue
                pts.append((lng, lat, ele))
            if len(pts) >= 2:
                segs.append(pts)
        elif name == "coord" and el.text:
            # gx:Track 的 <gx:coord>lng lat alt</gx:coord>，一个点一个元素
            parts = el.text.split()
            if len(parts) >= 2:
                try:
                    gx.append((float(parts[0]), float(parts[1]),
                               float(parts[2]) if len(parts) > 2 else None))
                except ValueError:
                    pass
    flush_gx()
    return segs


def parse_geojson(path):
    """GeoJSON → **分段**折线：每个 LineString 是一段（MultiLineString 天然分段）"""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    def coords_of(raw):
        pts = []
        for c in raw or []:
            if not isinstance(c, (list, tuple)) or len(c) < 2:
                continue
            try:
                ele = float(c[2]) if len(c) > 2 and c[2] is not None else None
                pts.append((float(c[0]), float(c[1]), ele))
            except (TypeError, ValueError):
                continue
        return pts

    segs = []

    def walk(node):
        if isinstance(node, list):
            for x in node:
                walk(x)
            return
        if not isinstance(node, dict):
            return
        t = node.get("type")
        if t == "LineString":
            p = coords_of(node.get("coordinates"))
            if len(p) >= 2:
                segs.append(p)
        elif t == "MultiLineString":
            for line in node.get("coordinates") or []:
                p = coords_of(line)
                if len(p) >= 2:
                    segs.append(p)
        elif t == "FeatureCollection":
            for feat in node.get("features") or []:
                walk(feat)
        elif t == "Feature":
            walk(node.get("geometry") or {})
        elif t == "GeometryCollection":
            for g in node.get("geometries") or []:
                walk(g)
        elif t == "Point":
            p = coords_of([node.get("coordinates")])
            if len(p) >= 2:
                segs.append(p)

    walk(data)
    return segs


def load_track(path):
    """统一返回**分段**点列：[[(lng, lat, ele), ...], ...]"""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".gpx":
        return parse_gpx(path)
    if ext == ".kml":
        return parse_kml(path)
    if ext in (".geojson", ".json"):
        return parse_geojson(path)
    raise ValueError(f"不支持的格式：{ext}")


# ---------- 清理与简化 ----------

def dedupe(pts, min_m=1.0):
    out = []
    for p in pts:
        if not out or haversine_m(out[-1], p) >= min_m:
            out.append(p)
    return out


def simplify(pts, tol_m):
    """Douglas–Peucker（在等距平面近似下算，济州岛尺度足够准）"""
    if len(pts) < 3 or tol_m <= 0:
        return pts
    kx = math.cos(math.radians(sum(p[1] for p in pts) / len(pts)))
    xs = [p[0] * kx for p in pts]
    ys = [p[1] for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    # 平面近似里 x 已按 cos(lat) 缩放、y 直接用纬度，两者单位都是「度」，
    # 所以容差也从米换算成度（1° 纬 ≈ 111.32 km）
    tol = tol_m / 111320.0
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        ax, ay, bx, by = xs[i], ys[i], xs[j], ys[j]
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        best_d = -1.0
        best_k = -1
        for k in range(i + 1, j):
            if den == 0:
                d = math.hypot(xs[k] - ax, ys[k] - ay)
            else:
                t = ((xs[k] - ax) * dx + (ys[k] - ay) * dy) / den
                t = max(0.0, min(1.0, t))
                d = math.hypot(xs[k] - (ax + t * dx), ys[k] - (ay + t * dy))
            if d > best_d:
                best_d, best_k = d, k
        if best_d > tol:
            keep[best_k] = True
            stack.append((i, best_k))
            stack.append((best_k, j))
    return [p for p, k in zip(pts, keep) if k]


def simplify_to_budget(pts, tol_m, max_points):
    """先按容差简化；仍超预算就逐步放宽容差，保证 JSON 体积可控"""
    out = simplify(pts, tol_m)
    t = tol_m
    while len(out) > max_points and t < 400:
        t *= 1.6
        out = simplify(pts, t)
    return out, t


def simplify_segments(segs, tol_m, max_points):
    """逐段简化；**总点数**超预算就整体放宽容差重来。

    ⚠️ 预算按所有段合计算：每段单独给 max_points 的话，段一多总点数就爆了。
    """
    t = tol_m
    out = [simplify(s, t) for s in segs]
    while sum(len(s) for s in out) > max_points and t < 400:
        t *= 1.6
        out = [simplify(s, t) for s in segs]
    return out, t


# ---------- 编号识别 ----------

def guess_code(path, explicit):
    stem = os.path.splitext(os.path.basename(path))[0]
    if stem in explicit:
        return explicit[stem], "指定"
    s = stem.lower()
    for w in NOISE_WORDS:
        s = s.replace(w, "_")
    # 年份与版本号不是路线编号，先剔掉（"JejuOlle2024_18-1_v2" 里的 2024 与 v2）。
    # ⚠️ 不能用 \b：'2024_18' 里 4 与 _ 都是正则的「词字符」，\b 不会成立。
    s = re.sub(r"(?<!\d)20\d{2}(?!\d)", "_", s)
    s = re.sub(r"(?<![a-z0-9])v\d+(?![a-z0-9])", "_", s)
    s = re.sub(r"[^0-9]+", "_", s).strip("_")
    if not s:
        return None, "无法识别"
    parts = s.split("_")
    if len(parts) == 1 and len(parts[0]) == 1:
        code = f"0{parts[0]}"
    elif len(parts) == 1:
        code = parts[0]
    elif len(parts) == 2 and len(parts[1]) == 1:
        head = parts[0] if len(parts[0]) == 2 else f"0{parts[0]}"
        code = f"{head}-{parts[1]}"
    else:
        return None, f"数字歧义（{s}）"
    return (code, "文件名") if code in ROUTE_CODES else (None, f"编号 {code} 不在 27 条里")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", nargs="+", required=True, help="轨迹文件或目录（可多个）")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--tol", "--tolerance", dest="tol", type=float, default=8.0, help="简化容差（米）")
    ap.add_argument("--max-points", type=int, default=420)
    ap.add_argument("--map", action="append", default=[], help="文件名=编号，如 jeju1.gpx=01")
    ap.add_argument("--reverse", action="append", default=[], help="翻转方向，可多次")
    ap.add_argument("--elevation", action="store_true",
                    help="轨迹没有海拔时联网补（opentopodata SRTM 30m，结果带缓存）")
    ap.add_argument("--dry", action="store_true", help="只解析报告，不写文件")
    ap.add_argument("--strict", action="store_true", help="有认不出编号的文件就报错退出")
    args = ap.parse_args()

    explicit = dict(m.split("=", 1) for m in args.map if "=" in m)
    elev_cache = load_elev_cache() if args.elevation else {}
    elev_dirty = False

    files = []
    for src in args.src:
        src = os.path.expanduser(src)
        if os.path.isdir(src):
            for ext in ("gpx", "kml", "geojson", "json"):
                files.extend(sorted(glob.glob(os.path.join(src, f"*.{ext}"))))
                files.extend(sorted(glob.glob(os.path.join(src, f"*.{ext.upper()}"))))
        elif os.path.isfile(src):
            files.append(src)
        else:
            sys.exit(f"找不到：{src}")
    files = sorted(set(files), key=lambda p: os.path.basename(p).lower())
    if not files:
        sys.exit("没找到任何 .gpx / .kml / .geojson 文件")

    print(f"扫到 {len(files)} 个轨迹文件\n")
    print(f"{'文件':<38} {'编号':<6} {'来源':<8} 说明")
    print("-" * 88)
    matched, unmatched = {}, []
    for path in files:
        code, how = guess_code(path, explicit)
        name = os.path.basename(path)
        short = name if len(name) <= 36 else name[:33] + "..."
        note = "" if code else how
        if code and code in matched:
            note = f"⚠️ 编号 {code} 已被 {os.path.basename(matched[code])} 占用，本条忽略"
            code, how = None, "冲突"
        print(f"{short:<38} {code or '—':<6} {how:<8} {note}")
        if code:
            matched[code] = path
        else:
            unmatched.append(path)

    if unmatched and args.strict:
        sys.exit(f"\n有 {len(unmatched)} 个文件认不出编号，--strict 模式退出。用 --map 文件名=编号 指定。")

    print()
    out = {}
    suspicious = []
    t0 = time.time()
    print(
        f"{'编号':<6} {'原始点':>7} {'简化':>6} {'段':>3} {'轨迹km':>8} {'官方km':>7} {'差':>6} "
        f"{'爬升m':>6} {'海拔':>5}  起点 → 终点"
    )
    print("-" * 116)
    for code in ROUTE_CODES:
        path = matched.get(code)
        if not path:
            continue
        try:
            segs = load_track(path)
        except Exception as err:
            print(f"{code:<6} 解析失败：{err}")
            continue
        segs = [dedupe(s) for s in segs]
        segs = [s for s in segs if len(s) >= 2]
        if not segs:
            print(f"{code:<6} ⚠️ 有效点不足 2 个，跳过")
            continue
        if code in args.reverse:
            # 反向：每段翻转，段的先后也翻过来
            segs = [s[::-1] for s in segs][::-1]
        raw_n = sum(len(s) for s in segs)

        segs, tol = simplify_segments(segs, args.tol, args.max_points)
        # 只补「整条都没有海拔」的轨迹；GPX 自带的记录海拔优先保留，不覆盖。
        # 放在简化之后：请求数直接少一个数量级。
        filled_ele = False
        if args.elevation and not any(p[2] is not None for s in segs for p in s):
            flat = [p for s in segs for p in s]
            before = len(elev_cache)
            eles_filled = fill_elevations(flat, elev_cache)
            elev_dirty = elev_dirty or len(elev_cache) != before
            if any(e is not None for e in eles_filled):
                it = iter(eles_filled)
                segs = [[(p[0], p[1], next(it)) for p in s] for s in segs]
                filled_ele = True

        km = sum(path_len_m(s) for s in segs) / 1000
        flat = [p for s in segs for p in s]
        has_ele = all(p[2] is not None for p in flat)
        if has_ele:
            # ⚠️ 爬升**逐段累加**：段与段之间海拔是未知的，混在一起算会凭空多一大截
            gain = loss = 0
            for s in segs:
                g, l = gain_loss([p[2] for p in s])
                gain += g
                loss += l
            eles = [p[2] for p in flat]
            hi, lo = round(max(eles)), round(min(eles))
        else:
            gain = loss = None
            hi = lo = None
        off = OFFICIAL_KM.get(code)
        diff = f"{km - off:+.1f}" if off else "—"

        def pack(p):
            return [round(p[0], 6), round(p[1], 6), (round(p[2], 1) if p[2] is not None else None)]

        # 坐标压到 6 位（约 0.1 m）、海拔 1 位，控制体积
        out[code] = {
            "source": os.path.basename(path),
            "basis": "track",
            "km": round(km, 2),
            "gainM": gain,
            "lossM": loss,
            "highestM": hi,
            "lowestM": lo,
            "toleranceM": round(tol, 1),
            "segmentCount": len(segs),
            "elevSource": "SRTM 30m · opentopodata.org（轨迹本身无海拔，联网补采样）" if filled_ele
                          else ("track" if has_ele else None),
            "points": [pack(p) for p in flat],
        }
        # 有断口才写 segments：前端按段画，段之间不连线
        if len(segs) > 1:
            out[code]["segments"] = [[pack(p) for p in s] for s in segs]

        s, e = flat[0], flat[-1]
        ele_col = "SRTM" if filled_ele else ("有" if has_ele else "无")
        seg_col = f"{len(segs)}" if len(segs) > 1 else "—"
        print(
            f"{code:<6} {raw_n:>7} {len(flat):>6} {seg_col:>3} {km:>8.2f} {off or 0:>7.1f} {diff:>6} "
            f"{(gain if gain is not None else '—'):>6} {ele_col:>5}  "
            f"{s[0]:.5f},{s[1]:.5f} → {e[0]:.5f},{e[1]:.5f}"
        )
        # 与官方里程差太多 → 轨迹可能不完整、方向不对或根本是另一条线，值得人工看一眼
        if off and abs(km - off) / off > 0.25:
            suspicious.append(f"{code}（轨迹 {km:.1f}km vs 官方 {off}km）")
        if len(segs) > 1:
            suspicious.append(f"{code} 有 {len(segs)} 段、{len(segs) - 1} 处断口，地图上会留缺口")

    print()
    missing = [c for c in ROUTE_CODES if c not in out]
    print(f"导入 {len(out)}/{len(ROUTE_CODES)} 条，耗时 {time.time() - t0:.1f}s")
    if missing:
        print(f"仍缺（前端会保持原样，不走真实轨迹）：{', '.join(missing)}")
    if suspicious:
        print(f"⚠️ 需要人工看一眼：{'；'.join(suspicious)}")
    no_ele = [c for c, v in out.items() if v["gainM"] is None]
    if no_ele:
        print(f"⚠️ 轨迹里没有海拔、剖面会显示「暂缺海拔数据」：{', '.join(no_ele)}")
        print("   想补海拔：加 --elevation 重跑（用 opentopodata 的 SRTM 30m，结果有缓存）。")

    # 海拔缓存先落盘，免得 --dry 或后续报错把已经查到的点白扔了
    if elev_dirty:
        save_elev_cache(elev_cache)
        print(f"海拔缓存已更新：{os.path.relpath(ELEV_CACHE, ROOT)}")

    if args.dry:
        print("\n--dry：未写文件。")
        return
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(args.out) / 1024
    print(f"\n-> {args.out}（{size:.0f} KB）")
    print("刷新页面即可生效（前端运行时读取，不落 localStorage）。")


if __name__ == "__main__":
    main()
