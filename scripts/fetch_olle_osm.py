#!/usr/bin/env python3
"""从 OpenStreetMap 抓取偶来小路各条路线的**真实走向**，导出 GeoJSON 给 import_tracks.py 用。

为什么走 OSM，而不是别的地方：
  官方 jejuolle.org 只公布每条线的**起点/终点 GPS 坐标**（例如 7-1 线
  33.249104,126.508588 → 33.247461,126.558717），拿不到中间怎么走 —— 用它只能画出
  一根直线，跟现在的问题一模一样。
  而 OSM 里部分偶来小路建了 `route=hiking` 的 route relation，成员就是实际步道
  （footway / path / 村道）的 way。**把成员 way 缝起来，就是一条能照着走的轨迹。**

⚠️ **OSM 里这些线有两个来源，缺一不可**（实测 2026-09-28）：
  1. **route relation** —— 整条线编成了一个关系，取成员 way 即可；
  2. **名字里带编号的散 way** —— 一大批线**根本没建关系**，而是被人一条条 way 地
     打了名字（`올레길 12`、`올레길 13`、`올레길 14 (Ollegil 14)`、`올레길15-A`…）。
     只查 relation 会把 12 / 13 / 14 / 15 全判成「OSM 没建」，前端只能拿 seed.ts 里
     的**城镇级近似坐标连直线** —— 地图上看就是西部凭空一根斜穿岛内的直线，
     既没沿海岸走、也接不上相邻课程。**这不是「OSM 数据不全」，是取数只取了一半。**
  所以本脚本会**两个来源都取**，同一编号按「判定档位 → 断口总长 → 覆盖接近 1.0」
  择优（见 `main()` 里的候选比选）：relation 有缺口的（如 08 少 5.6km）常常被散 way 补上，
  而散 way 覆盖不全的又常常靠 relation 补回来。
  实测：只跑 relation 拿到 14/27；加上散 way 后 12 / 13 / 14 / 15 与 14-1 都能成线。

用法：
    python3 scripts/fetch_olle_osm.py                    # 全量抓取并导出
    python3 scripts/fetch_olle_osm.py --dry              # 只报告覆盖情况，不写文件
    python3 scripts/fetch_olle_osm.py --dry --broad      # 顺带确认「还差的编号」OSM 里有没有
    python3 scripts/fetch_olle_osm.py --only 01 07-1     # 只抓这几条（排查用）
    python3 scripts/fetch_olle_osm.py --alias 03-A=03    # OSM 里的变体编号映射到你的编号
    python3 scripts/fetch_olle_osm.py --max-coverage 1.25  # 比官方长 25% 以上的一律不导出
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
  5. **拒绝「闭合旁路」**：走完候选 way 若会落回链子**内部**已走过的节点，那它是
     绕一圈回到原路的**替代支线**（OSM 常把 A/B 变体、无障碍路线塞进同一个关系），
     不是「往前走」。收下它会把绕行线接到终点后面 —— 实走里程会**比官方还长**，
     而这是不可能的。这类段默认剔出几何与里程，报表如实写明剔了多长；
     `--keep-parallel` 可保留。**实测证据只有 03**（剔前 29.76km/142% → 剔后 22.71km/109%）
     与 05（15.33→14.60，剔 0.74km）；`07` 剔完仍长 54%，说明它另有原因，别拿这条解释它。
  6. 接不上就**收尾、从池子里另起一段**（不是硬连一条直线）。段与段之间就是 OSM
     真没画的地方，导出成 MultiLineString，前端画出来是有缺口的折线 —— 不伪造。
  7. **段内折返单独报数**（`_loops`）：同一节点在一段里被走两次 → 中间那几公里白走。
     它和并联段的区别是**能不能拆出来**：并联段能拆成独立一段（两端挂回主线）→ 剔；
     折返长在这一段内部 → **剔不掉**，只能报「处数/米数」让人对着地图判断
     （是这条线本就含往返段，还是缝合在岔路口走岔了又走回来）。

⚠️ **实走里程比官方长，还有第三种原因：这个关系映射的根本不是那条线。**
   实测 07：缝合完全正常（无并联段、无折返、无回头路、蜿蜒系数 1.62），
   但实走 19.80km / 官方 12.9km。查下来是 **OSM 关系走的是「延长到月坪浦口」的旧走向**，
   而官方现行 7 线早已止于西归浦巴士总站（jejuolle.org：旅游中心→巴士总站 12.9km）。
   这类问题**内部一致性检查查不出来**（几何本身自洽），只有两个线索：
     · **里程倒挂**（本例 154%）——所以 `MAX_COVERAGE` 默认直接拦，不再只提示；
     · 官方站点会发「区间变更」公告（如 2026-07-01「7코스 법환포구 구간 변경」），
       OSM 是历史快照，改线后不会自动跟上。
   想确认只能拿**官方起终点 GPS** 对（`src/lib/seed.ts` 的 PLACES 是城镇级近似坐标，
   偏差可达 10km，**不能**用来做这道判定，别拿它当闸门）。

⚠️ **「实走 > 官方」这条口径的前提是官方里程本身是对的。**
   曾经因为脚本里手抄的官方里程是旧数据（09 写成 8.0，官方现行 12.3），
   把 99% 正常的 09 报成「153%、比官方长」，白查了一轮缝合算法。
   里程现在从 `src/lib/seed.ts` 读（见 import_tracks.py 的 `load_official_km`），
   别在这里再抄一份；判「超长」之前先确认基准没问题。

⚠️ 两个诚实的边界：
1. **OSM 是众包数据，覆盖不全**：本脚本会打印「拿到几条 / 还差几条」。缺的那几条
   OSM 根本没建关系，跟脚本无关，得换源（见 README 的「轨迹从哪来」）。
2. OSM 的 way 上**没有海拔**，所以本脚本只管走向；海拔交给 import_tracks.py 的
   `--elevation`（opentopodata 的 SRTM 30m）补。
"""

import argparse
import hashlib
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
# 判定「并联段」（两端都接回主线）时，端点离主线多近算接上
PARALLEL_TOL_M = 120.0
# ⚠️ 实走里程 / 官方里程 **高于**它就不再是「缝合噪声」，而是**走向与官方不符**，
#    默认直接判定不可用、不导出（宁可缺、不可假）。实测依据：
#      · 07 的 OSM 关系 = 154% —— 它把线从月坪继续往西延到了月坪浦口以外；
#        官方现行 7 线止于月坪（月坪正是 8 线的起点，偶来各线首尾相接）。
#      · 正常线都落在这个阈值以内（03 剔并联段后 109%、05 109%、16 108%）。
#    确实想把超长的也收进来，传 `--max-coverage 0` 关掉这道闸（或 `--keep-bad`）。
MAX_COVERAGE = 1.30

# 变体编号 → 主线编号的默认映射（命令行 --alias 可以覆盖/追加）。
# ⚠️ 这条要放成默认值，否则「重跑一遍」的命令会长到没法记，早晚会漏参数导致
#    某个编号静默退回「没数据」。当前只有一条：OSM / GPX 把 3 线拆成 3-A、3-B 两种走法，
#    官方的 03 对应的是 3-A 那条（GPX 22.34km/107%、0 断口）。
DEFAULT_ALIAS = {"03-A": "03"}

# 明确不导出的编号（连同原因）。**故意写成「对某一条线的判断」，而不是再去调阈值** ——
# 阈值是全局的，为了一条线放宽/收紧会连带影响另外 20 多条。
# 判据：现有几套几何**没有一套能拼成一条连贯的线**时，宁可留一条标注「示意」的虚线，
# 也不要把一条首尾乱跳的折线放到地图上冒充实测轨迹。
SKIP = {
    "14-1": (
        "现有两套几何都不可信 —— "
        "OSM 那 19 条 en way 缝出来是 4 段且首尾乱跳（第 1 段往西南走 6.9km 后断掉，"
        "第 2 段又跳回起点附近往北走），覆盖率 122% 但走的是「回头路 + 岔路」；"
        "GPX 里的 14-1 段 17.55km = 官方 9.3km 的 **189%**，八成是官方改线前的旧走向。"
        "官方 14-1 只有 9.3km（渚旨→西光），两套候选一个碎一个超长，都不够格。"
    ),
}

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


def dedupe_elements(elements):
    """按 (type, id) 去重。补抓子关系后可能和主查询的结果重叠，不去重会让同一条关系
    在报表里出现两行、还会重复参与「留覆盖更好那条」的比选。"""
    seen, out = set(), []
    for e in elements or []:
        k = (e.get("type"), e.get("id"))
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
    return out


def missing_child_ids(elements):
    """返回「被当作成员引用、但这次没取回几何」的子关系 id。

    ⚠️ `out geom` 不会递归进子关系，所以 superroute 的成员（子关系）必须单独取一次。
    正常靠查询里的 `rel(br.r)` 一句带走；但**部分镜像不支持 `br()`，会回 HTTP 400**，
    降级之后就只能指望子关系自己也被 name/ref 过滤器命中 —— 名字写法不同的那些会静默丢失。
    这里算出缺口，再用 rel(id:...) 精确补一次，跟 `br()` 支不支持无关。
    """
    have = {e.get("id") for e in elements if e.get("type") == "relation"}
    want = []
    for e in elements or []:
        if e.get("type") != "relation":
            continue
        for m in e.get("members") or []:
            if m.get("type") == "relation" and m.get("ref") not in have:
                want.append(m["ref"])
    return sorted(set(want))


def build_children_query(ids):
    return (
        "[out:json][timeout:300];\n"
        f"rel(id:{','.join(str(i) for i in ids)});\n"
        "out geom;\n"
    )


def build_broad_query():
    """不带 name/ref/network 过滤，把框里**所有** hiking/foot/walking 的 route 关系列出来。

    用途只有一个：回答「还差的那些编号（12/13/15/17/21…）OSM 里到底有没有」。
    正常查询靠名字命中，名字写法不对就漏；这一遍只看名字，能确认是「真没有」还是「没匹配上」。
    """
    s, w, n, e = BBOX
    return (
        "[out:json][timeout:600];\n"
        f'rel({s},{w},{n},{e})["type"~"^(route|superroute)$"]'
        '["route"~"^(hiking|foot|walking)$"];\n'
        "out tags;\n"
    )


def build_ways_query():
    """抓「名字里带 올레 / Olle 的道路 way」—— 第二个数据源，见模块 docstring。

    为什么必须分开查：
      · 相当一部分线**没有 route relation**，只以「打了名字的 way」形式存在；
      · 关系也可能只画了一半，而缺掉的那半在这里有（08 少 5.6km 就是这种）。
    只限定 `highway` 是因为「바다올레길 카라반 캠핑장 / 자주올레펜션」这类**同名 POI**
    也带「올레」，不筛会把露营地、民宿的轮廓当成步道缝进去。
    """
    s, w, n, e = BBOX
    box = f"{s},{w},{n},{e}"
    return (
        "[out:json][timeout:600];\n"
        "(\n"
        f'  way({box})["highway"]["name"~"올레"];\n'
        f'  way({box})["highway"]["name"~"Olle",i];\n'
        ");\n"
        "out geom;\n"
    )


KO_RE = re.compile("올레")
EN_RE = re.compile(r"Olle\s*(?:Trail|Route|Gil)", re.I)


def style_of(name):
    """这条 way 的名字属于哪套命名习惯：'ko' / 'en' / '?'。

    ⚠️ **OSM 上同一个编号有两套名字，是两个不同的 way 集合，覆盖同一段路**：
        韩文 `올레길 12`（零散，全岛 7 条）  和  英文 `Ollegil 12`（完整，70 条）。
        只按韩文名统计会得出「OSM 没建 12 / 13 / 14 / 15」的**错误结论** ——
        这正是前一轮走的最大弯路。反过来，把两套混在一个池子里缝，
        等于把同一段路喂两遍：段数暴涨、断口满天飞（实测 12 只画出 43%、15 只有 73%）。
    """
    if not name:
        return "?"
    if KO_RE.search(name):
        return "ko"
    if EN_RE.search(name):
        return "en"
    return "?"


def named_ways(elements):
    """把散 way 按 (编号, 命名习惯) 分组 → {(code, style): [{'id','role','pts'}]}。

    ⚠️ 必须按 way id 去重：两条 name 规则（韩文 / Olle）会命中同一条 way，
        不去重会把它缝进同一条线两次 —— 表现是「里程凭空翻倍 + 段内有折返」。
    ⚠️ 拿不到 geometry 的 way（镜像省略了几何）直接跳过，不要让空 pts 进池子。
    """
    out, seen = {}, set()
    for e in elements or []:
        if e.get("type") != "way":
            continue
        wid = e.get("id")
        if wid in seen:
            continue
        name = (e.get("tags") or {}).get("name") or ""
        code = code_from_name(name)
        if not code:
            continue
        pts = [
            (float(p["lon"]), float(p["lat"]))
            for p in (e.get("geometry") or [])
            if isinstance(p, dict) and "lon" in p and "lat" in p
        ]
        if len(pts) < 2:
            continue
        seen.add(wid)
        out.setdefault((code, style_of(name)), []).append(
            {"id": wid, "role": "", "pts": pts})
    return out


def named_by_style(named, code):
    """某个编号下按命名习惯分好的 {style: [ways]}。缝的时候要按这一层分开取。"""
    return {st: ws for (c, st), ws in named.items() if c == code}


def cached_overpass(endpoint, query, cache_dir=None, offline=False):
    """带缓存的 Overpass 调用（`--cache-dir` / `--offline`）。

    为什么值得有：Overpass 公共实例**经常 504/429**，一条大查询能连着失败十几分钟。
    把每次响应按「查询内容的哈希」落盘，重跑时同一条查询直接读盘 ——
    调参、改判定、重出图都不用再赌一次网络。
    """
    path = None
    if cache_dir:
        path = os.path.join(cache_dir,
                            hashlib.sha1(query.encode("utf-8")).hexdigest()[:16] + ".json")
        if os.path.exists(path):
            print(f"  读缓存 {os.path.basename(path)}（要按 OSM 最新重抓就删掉它）")
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        if offline:
            raise QueryRejected(f"缓存里没有这条查询（{os.path.basename(path)}），--offline 下不联网")
        os.makedirs(cache_dir, exist_ok=True)
    data = overpass(endpoint, query)
    if path:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    return data


def load_reused(directory):
    """把上一轮导出的 `olle-<编号>.geojson` 读回来，当作 relation 侧的几何。

    返回 {code: (ways, rel_like)}；ways 的格式与 `ways_of()` 一致，可以直接丢给 join_ways。
    属性里的 osmRelation / name 会还原成 rel_like，重新导出时不丢出处。

    ⚠️ 这是「续跑」用的，不是「替代 OSM」：拿到的永远是**上次那份**快照。
        想按 OSM 最新重抓，别传 --reuse-dir。
    """
    out = {}
    skipped_src = []
    if not directory or not os.path.isdir(directory):
        return out
    for fn in sorted(os.listdir(directory)):
        if not (fn.startswith("olle-") and fn.endswith(".geojson")):
            continue
        code = fn[len("olle-"):-len(".geojson")]
        try:
            with open(os.path.join(directory, fn), encoding="utf-8") as f:
                gj = json.load(f)
            feat = gj["features"][0]
        except (OSError, ValueError, KeyError, IndexError):
            continue
        g = feat.get("geometry") or {}
        raw = g.get("coordinates") or []
        if g.get("type") == "LineString":
            raw = [raw]
        # ⚠️ 只复用「来历是 OSM 关系」的文件。
        #    否则会把**上一轮的产物**当成 relation 复用成自引用：比如 14-1 上一轮
        #    是用散 way 缝的，这一轮它又会被当成「relation 侧几何」，来源标签就从
        #    「way」变成「复用的 geojson」，越滚越看不出来历；GPX 产物同理
        #    （`geomSource: gpx` 却摆进 relation 槽位）。
        #    `both-*` 放行：它的底子就是 relation，补缺只是加了几段。
        src = (feat.get("properties") or {}).get("geomSource") or ""
        if not (src == "relation" or src.startswith("both-")):
            skipped_src.append(f"{code}（{src or '没写 geomSource'}）")
            continue
        ways = [
            {"id": -(i + 1), "role": "", "pts": [(float(x), float(y)) for x, y in seg]}
            for i, seg in enumerate(raw) if len(seg) >= 2
        ]
        if not ways:
            continue
        props = feat.get("properties") or {}
        out[code] = (ways, {
            "id": props.get("osmRelation"),
            "tags": {"name": props.get("name"), "name:en": props.get("nameEn")},
        })
    if skipped_src:
        # 直接在这里报，别让调用方去猜「为什么复用的条数变少了」
        print(f"  （跳过 {len(skipped_src)} 个来历不是 OSM 关系的文件："
              f"{'、'.join(skipped_src)} —— 它们上一轮是从 GPX / 散 way 来的，"
              "复用了会变成自引用）")
    return out


def uncovered_ways(extra, base_segs, tol_m=25.0, min_keep_m=40.0):
    """从 `extra` 里挑出「base 上还没有的那部分」，用来补 relation 的缺口。

    ⚠️ **不能直接取并集。** 同一条路在 OSM 里常常既有 relation 成员、又有带名字的 way，
        两份几何是**同一段路**。直接相加会缝出两条重叠的线，然后被 `_seg_links` 判成
        「并联段」整段剔掉 —— 实测 01 / 11 就是这样变成 **0 段**的（线整条消失），
        而且报表上只会写「并联段已剔除」，看不出是这里出的错。

    做法：逐点判断 extra 里的点离 base 有多远（≤tol_m 算「已有」），
    把每条 way 头部/尾部已经有的点剪掉，只留中间那段真的缺的。
    剪完不足 `min_keep_m` 的整条丢掉。**只剪首尾、不动中间**，行为可预期。
    """
    if not extra or not base_segs:
        return list(extra)
    base_pts = [p for seg in base_segs for p in seg]
    if not base_pts:
        return list(extra)
    # 0.001 度 ≈ 100m 的桶，避免 每点 × 每基点 的全量比对
    cell = 0.001
    grid = {}
    for p in base_pts:
        grid.setdefault((round(p[0] / cell), round(p[1] / cell)), []).append(p)
    tol2 = (tol_m / 111320.0) ** 2

    def covered(p):
        cx, cy = round(p[0] / cell), round(p[1] / cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for q in grid.get((cx + dx, cy + dy), ()):
                    if (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= tol2:
                        return True
        return False

    out = []
    for w in extra:
        pts = w.get("pts") or []
        flags = [not covered(p) for p in pts]
        if not any(flags):
            continue                      # 整条都已在 base 上 → 是重复的，扔掉
        first, last = flags.index(True), len(flags) - 1 - flags[::-1].index(True)
        keep = pts[first:last + 1]
        if len(keep) < 2 or path_len_m(keep) < min_keep_m:
            continue
        out.append({"id": w.get("id"), "role": w.get("role", ""), "pts": keep})
    return out


def read_course_gpx(path):
    """读「按课程分段」的 GPX（每段一个 `<trk>`，名字就是编号）→ {code: [ways]}。

    段名形如 `KML Merge_Jeju Olle 12` / `… 7-1` / `… 10.1` / `… 3A`，统一归成
    `12` / `07-1` / `10-1` / `03-A`。

    ⚠️ GPX 的 `<trkpt lat=".." lon="..">` 是 **lat 在前**，读进来必须摆成 (lng, lat)；
        摆反了不会报错，只会让所有里程变成垃圾数（实测踩过）。
    """
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    out = {}
    for t in re.findall(r"<trk>(.*?)</trk>", raw, re.S):
        nm = re.search(r"<name>([^<]*)</name>", t)
        code = code_from_gpx_name(nm.group(1) if nm else "")
        if not code:
            continue
        pts = [
            (float(m.group(2)), float(m.group(1)))          # (lon, lat)
            for m in re.finditer(r'<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"', t)
        ]
        if len(pts) >= 2:
            out.setdefault(code, []).append({"id": f"gpx:{code}", "role": "", "pts": pts})
    return out


def code_from_gpx_name(name):
    """`KML Merge_Jeju Olle 12` → '12'；`… 7-1` → '07-1'；`… 10.1` → '10-1'；`… 3A` → '03-A'"""
    s = (name or "").replace("KML Merge_Jeju Olle", "").replace("KML Merge_ Jeju Olle", "").strip()
    m = re.match(r"^(\d{1,2})(?:[.\-]\s*(\d{1,2}))?\s*([A-Za-z])?$", s)
    if not m:
        return None
    code = f"{int(m.group(1)):02d}"
    if m.group(2):
        code += f"-{int(m.group(2))}"
    if m.group(3):
        code += f"-{m.group(3).upper()}"
    return code


# 只要偏差超过这个距离，就说明「这条轨迹的端点根本不在官方那个点上」
ENDPOINT_TOL_M = 2000.0


def load_official_endpoints(seed_path):
    """从 `src/lib/seed.ts` 读出**带「官方 GPS」标记**的地点坐标，以及各课程的起终点用的哪个地点。

    为什么要这一步：里程对得上 ≠ 走向对得上。实测 GPX 里的 07 段里程 12.75km，
    跟官方 12.9km 只差 1%，看着完美 —— 但它走的是**旧走向**（一路到月坪），
    终点离官方现行终点西归浦巴士总站差 4.8km。光靠里程永远发现不了，只能拿官方端点坐标卡。

    返回 (places, ends)：places = {地点名: (lng, lat)}；
    ends = {课程编号: (起点地点名|None, 终点地点名|None)}，只含能确定的。
    """
    if not seed_path or not os.path.exists(seed_path):
        return {}, {}
    with open(seed_path, encoding="utf-8") as f:
        src = f.read()
    places = {}
    for m in re.finditer(
            r"(\w+):\s*\{[^}]*lng:\s*([-\d.]+),\s*lat:\s*([-\d.]+)[^}]*\}\s*,"
            r"\s*//\s*官方 GPS", src):
        places[m.group(1)] = (float(m.group(2)), float(m.group(3)))
    ends = {}
    for m in re.finditer(
            r"\{\s*code:\s*'([\d-]+)',\s*start:\s*'(\w+)',\s*end:\s*'(\w+)'", src):
        ends[m.group(1)] = (m.group(2), m.group(3))
    return places, ends


def endpoint_verdict(segments, want, places, tol_m=ENDPOINT_TOL_M):
    """拿**官方 GPS 端点**卡轨迹的两端。want = (起点地点, 终点地点)。

    返回 (ok, why)。任一端没有官方坐标就跳过那一端（不硬判，别拿近似坐标当闸门 —— 
    `seed.ts` 里绝大多数地点是城镇级近似值，偏差可达 10km）。
    允许整条反向：两侧各试一次取偏差小的那种配法。
    """
    have = [(name, places[name]) for name in (want or ()) if name in places]
    if not have or not segments:
        return True, ""
    pts = [p for seg in segments for p in seg]
    if not pts:
        return True, ""
    cand = {                     # 地点 → 轨迹上离它最近的那个端点
        name: min((pts[0], pts[-1]), key=lambda q: haversine_m(q, coord))
        for name, coord in have
    }
    worst = max(((name, haversine_m(cand[name], coord)) for name, coord in have),
                key=lambda x: x[1])
    if worst[1] > tol_m:
        return False, (f"端点对不上：离官方「{worst[0]}」{worst[1] / 1000:.1f}km "
                       f"（上限 {tol_m / 1000:.0f}km）—— 多半是这条线走的是**旧走向**")
    return True, ""


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


def _seg_links(segments, tol=PARALLEL_TOL_M):
    """给每一段标注「两端是不是都接回了主线」。

    判据：该段**两个**端点都落在「其它段的节点」附近。

      - **缺口续段**：被断口隔开的那一端离主线上千米，必然不满足 → 不会被误判，
        它的长度该算进实走里程；
      - **并联段**（替代支线）：比如 OSM 里把「올레길5 (Ollegil 5) wheelchair」
        这种无障碍替代线、A/B 变体也放在同一个关系里，缝合后它会变成一段
        **两端都挂回主线** 的独立段 —— 它的长度是**重复**的，算进实走里程
        就会让这条线比官方还长（实测 03：剔前 142%、剔后 109%）。

    只做标注，不擅自丢弃 —— 由调用方决定是提示还是剔除。
    """
    info = []
    for i, s in enumerate(segments):
        others = [p for j, t in enumerate(segments) if j != i for p in t]
        ends = [
            any(haversine_m(ep, p) <= tol for p in others)
            for ep in (s[0], s[-1])
        ] if others else [False, False]
        info.append({"km": path_len_m(s) / 1000.0, "both": all(ends), "ends": ends})
    return info


def _loops(seg):
    """一段里「同一节点被走了两次」的地方 —— 两次之间那段路是折返/绕环，白走的。

    返回 (处数, 米数)，米数 = **那段往返实际走掉的路**（不是重复几何的那一半）。
    只报数，不擅自剔除：环线本来就会回到起点（设计如此），要点是**把这几公里摆出来**，
    让人判断它是路线真实的往返段，还是缝合走岔了。

    ⚠️ 一处折返**只算一次**：取「路径间隔最大的那对重复点」当这一处的范围，内部嵌套的
    小配对不再重复计。否则一条来回走的线会按每个节点各报一次 —— 实测 12 个点的往返段
    会被报成「11 处 / 111km」，比整条线还长，纯属噪声。

    ⚠️ 「整段首尾闭合、中间没有别的重复点」不算 —— 那是环线收口（如牛岛 01-1），
    把它算进去会凭空报出一整条线的长度。
    """
    n, m = 0, 0.0
    last = len(seg) - 1
    stack = [(0, len(seg))]
    while stack:
        lo, hi = stack.pop()
        part = seg[lo:hi]
        first, pairs, ring = {}, [], None
        for i, p in enumerate(part):
            k = _key(p)
            j = first.get(k)
            if j is None:
                first[k] = i
                continue
            if lo + j == 0 and lo + i == last:
                ring = (j, i)                # 候选：环线收口
                continue
            pairs.append((j, i))
        if not pairs:
            continue                         # 只有首尾重合 = 环线收口（牛岛 01-1），不报
        if ring:
            # 端点重合 **且中间也有重复点** → 那是「整段走了个来回」，不是环线，要报
            pairs.append(ring)
        j, i = max(pairs, key=lambda pr: path_len_m(part[pr[0]:pr[1] + 1]))
        n += 1
        m += path_len_m(part[j:i + 1])
        # 折返段的前后各自可能还夹着别的重复，继续分开找
        stack.append((lo, lo + j + 1))
        stack.append((lo + i, hi))
    return n, m


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

    ⚠️ **还会拒绝「闭合旁路」**：如果走完候选 way 会落回链子**内部**已经走过的节点，
    那它不是一个「往前走」的候选，而是一条绕一圈回到原路的替代线
    （OSM 常把 A/B 变体、无障碍路线塞在同一个关系里）。收下它会把绕行线接到终点后面，
    里程凭空多出好几公里（03 实测：剔前 142%、剔后 109%）。
    正确做法是**不收**，让它自己成一段，再按「并联段」处理（见 `_seg_links`）。
    两端不在「内部」排除范围内 —— 环线（如牛岛 01-1）要靠它们收口。
    """
    while True:
        anchor = seg[-1] if forward else seg[0]
        k = _key(anchor)
        in_dir = _incoming_dir(seg) if forward else _incoming_dir(seg[::-1])
        # 链子内部（去掉两端）已经走过的节点：落回这里 = 闭合旁路
        interior = {_key(p) for p in seg[1:-1]} if len(seg) > 2 else set()
        cands = []
        for wi, w2 in enumerate(pool):
            pts = w2["pts"]
            last = len(pts) - 1
            hit = next((pi for pi, p in enumerate(pts) if _key(p) == k), None)
            if hit is not None:
                # 首选：节点级命中 —— OSM 共享节点坐标必然完全一致，可信度最高
                for step in (1, -1):
                    ni = hit + step
                    if not (0 <= ni <= last):
                        continue
                    arrive = pts[last] if step > 0 else pts[0]
                    if _key(arrive) in interior:
                        stats["bypass"] += 1
                        continue
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


def join_ways(ways, join_tol=JOIN_TOL_M, keep_parallel=False, bridge_m=0.0):
    """把无序的 way 集合缝成尽量连续的分段折线（算法说明见模块 docstring）。

    返回 (segments, gaps, stats)：
      segments — 分段折线 [[(lng, lat), ...], ...]；段与段之间是 OSM 真没画的地方，
                 **不要连线**，前端按多段绘制会自然留出缺口
      gaps     — [{'m': 断口米数, 'from': [lng, lat], 'to': [lng, lat]}]，供报告用
      stats    — 诊断计数（岔路口、中途劈开、闭合旁路、并联段…）

    keep_parallel=False（默认）会把**并联段**（两端都接回主线的替代支线）剔除，
    因为它们的长度是重复的，算进去会让实走里程比官方还长。
    要保留原样看，传 True。

    bridge_m > 0 时，把「最近端点相距不超过 bridge_m」的两段用**一条直线**接起来
    （`--bridge` CLI 开关，默认关闭）。见下面桥接那段的注释：只对几十~几百米的
    小断口有意义，别拿它去填几公里的真空洞。
    """
    # ⚠️ 按 way id 去重是必需的：「relation 成员 + 名字命中的散 way」合并时，
    #    同一条 way 会从两个来源各进来一次；缝两遍 = 里程凭空翻倍 + 段内折返。
    seen_ids, pool = set(), []
    for w in ways:
        pts = w.get("pts") or []
        if len(pts) < 2:
            continue
        wid = w.get("id")
        if wid is not None:
            if wid in seen_ids:
                continue
            seen_ids.add(wid)
        pool.append({"id": wid, "role": w.get("role", ""),
                     "pts": list(pts), "spur": False})
    if not pool:
        return [], [], {"ways": 0, "segments": 0, "junction": 0, "split": 0,
                        "backtrack": 0, "bypass": 0, "near": 0, "nearM": 0.0,
                        "spurDropped": 0.0, "segInfo": [], "parallelM": 0.0,
                        "parallelN": 0, "parallelDropped": False,
                        "loopN": 0, "loopM": 0.0,
                        "bridgedN": 0, "bridgedM": 0.0}

    stats = {"ways": len(pool), "junction": 0, "split": 0, "backtrack": 0,
             "bypass": 0, "near": 0, "nearM": 0.0, "spurDropped": 0.0}
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

    # 并联段（两端都接回主线）= 替代支线/同一段走了两遍。它会直接抬高实走里程，
    # 而那是不对的 —— 一条线不可能比它自己长。默认剔除（--keep-parallel 保留），
    # 剔除后**必须重算断口**，否则断口会指向已经被丢掉的那一段。
    info = _seg_links(segments)
    stats["segInfo"] = info
    # ⚠️ 这两个数**无论剔不剔除都要算**：报表靠它们解释「里程为什么虚高」，
    #    开了 --keep-parallel 就只是不剔除，说明照样要给。
    stats["parallelM"] = sum(x["km"] for x in info if x["both"]) * 1000.0
    stats["parallelN"] = sum(1 for x in info if x["both"])
    if not keep_parallel and stats["parallelN"]:
        keep_idx = [i for i, x in enumerate(info) if not x["both"]]
        segments = [segments[i] for i in keep_idx]
        stats["segInfo"] = [info[i] for i in keep_idx]
        stats["parallelDropped"] = True
    else:
        stats["parallelDropped"] = False

    # ---- 小断口直线桥接（--bridge，默认关）----
    # 断口分两种，处理方式完全不同：
    #   · 几十~几百米：OSM 就是把中间那一小截 way 漏了（路口、村里一段没画），
    #     真实走向在这么短的距离上几乎就是直线 —— 接上比留个豁口更接近实际；
    #   · 公里级：那是真没有数据（或关系只画了一半），拿直线连过去等于**凭空造一段
    #     不存在的路**，必须留着缺口。所以桥接阈值只该给到几百米，别图省事开大。
    # ⚠️ 桥接出来的那一段是**直线**，不是实测轨迹。米数如实记在 stats 里
    #    （bridgedN / bridgedM），报表与 GeoJSON 都要写明，不能当成实测数据。
    stats["bridgedN"], stats["bridgedM"] = 0, 0.0
    if bridge_m and bridge_m > 0 and len(segments) > 1:
        while len(segments) > 1:
            best = None
            for i in range(len(segments)):
                for j in range(i + 1, len(segments)):
                    ends = (
                        (0, segments[i][0]), (1, segments[i][-1]),
                        (2, segments[j][0]), (3, segments[j][-1]),
                    )
                    for ta, pa in ends[:2]:
                        for tb, pb in ends[2:]:
                            d = haversine_m(pa, pb)
                            if d <= bridge_m and (best is None or d < best[0]):
                                best = (d, i, j, ta, tb)
            if best is None:
                break
            d, i, j, ta, tb = best
            a, b = list(segments[i]), list(segments[j])
            # ta/tb 是「接合端在段内的位置」：0 = 首、1 = 尾（b 的取 2/3，2 = 首、3 = 尾）。
            # 目标：a 的接合端落到**尾部**、b 的接合端落到**首部**，否则拼出来会掉头往回走，
            # 里程凭空多出一段（实测就是这么发现的一个 sign 错误）。
            if ta == 0:          # a 的接合端在首 → 翻转，让它到尾部
                a.reverse()
            if tb == 3:          # b 的接合端在尾 → 翻转，让它到首部
                b.reverse()
            stats["bridgedN"] += 1
            stats["bridgedM"] += d
            segments = [s for k, s in enumerate(segments) if k not in (i, j)]
            segments.insert(i, a + b)

    stats["segments"] = len(segments)
    if stats["bridgedN"]:
        # 合并后段数变了，明细得重算，否则报表里的「每段多长」还是桥接前的
        stats["segInfo"] = _seg_links(segments)
    # 段内折返/绕环：同一个节点在一段里被走了两次 → 中间那段路是白走的。
    # 这是解释「实走比官方长」最直接的证据，和并联段是两码事：
    #   并联段 = 拆成了独立的一段，两端都挂回主线（会被剔除）；
    #   折返   = 就藏在**同一段内部**，剔不掉，只能报出来让人判断。
    # 07 就是这一类（剔完并联段仍长 54%，且只有 2 段却有一处掉头）。
    stats["loopN"], stats["loopM"] = 0, 0.0
    for s in segments:
        n, m = _loops(s)
        stats["loopN"] += n
        stats["loopM"] += m

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

    return segments, gaps, stats


def geojson_for(code, rel, segments, gaps, km, src="relation", nways=None, bridged=(0, 0.0)):
    """导出单条线的 GeoJSON。

    ⚠️ `rel` 可能为 None —— 12 / 13 / 14 / 15 这些是**只有散 way、没有关系**的线，
       属性里如实写 `osmRelation: null`，别硬塞一个 id 让人以为有出处。
    ⚠️ `bridged` 是「小断口直线桥接」的 (处数, 米数)：桥出来的那几段是**直线，不是实测**，
       必须写进属性，别让下游把它当成真轨迹。
    """
    rel = rel or {}
    tags = rel.get("tags") or {}
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
                    "geomSource": src,
                    "osmWays": nways,
                    "name": tags.get("name"),
                    "nameEn": tags.get("name:en"),
                    "source": "OpenStreetMap (ODbL)",
                    "segments": len(coords),
                    "gaps": len(gaps),
                    "gapM": round(gap_m, 1),
                    "bridgedN": bridged[0],
                    "bridgedM": round(bridged[1], 1),
                    "km": round(km, 2),
                    "officialKm": official,
                    "coverage": round(km / official, 3) if official else None,
                },
                "geometry": geometry,
            }
        ],
    }


def verdict_of(km, gap_m, official, min_cov=MIN_COVERAGE, max_frac=MAX_GAP_FRAC,
               max_cov=MAX_COVERAGE):
    """给一行数据下判定：✅ 可用 / ⚠️ 有缺段 / ⛔ 不可用

    ⚠️ **实走里程比官方还长 = 不可用，不是「数据更全」**：一条线不可能比它自己长。
    原因有三类，诊断区会分开报：
      · **并联段**（关系里混进替代支线/A/B 变体/无障碍路线）→ 两端都挂回主线，默认剔除；
      · **段内折返**（同一节点在一段里被走了两次）→ 剔不掉，得对着地图判断；
      · **关系映射的不是这条线**（旧走向 / 邻线延伸）→ 几何自洽、查不出来，
        只能靠里程倒挂发现（实测 07 = 154%，官方现行 7 止于西归浦巴士总站，
        OSM 关系却一直走到月坪浦口）。所以超长默认直接拦。
    判之前先确认官方里程基准是对的 —— 基准错了，这一栏全是假的。
    传 max_cov=0 可关掉「超长」这道闸。
    """
    walk_m = km * 1000
    frac = gap_m / (walk_m + gap_m) if (walk_m + gap_m) > 0 else 0.0
    cov = (km / official) if official else None
    bad, warn = [], []
    if cov is not None and cov < min_cov:
        bad.append(f"只画到 {cov * 100:.0f}%")
    if frac > max_frac:
        bad.append(f"断口占 {frac * 100:.0f}%")
    if cov is not None and max_cov and cov > max_cov:
        bad.append(
            f"比官方长 {cov * 100 - 100:.0f}%（走向与官方里程不符："
            "多半是官方已改线、OSM 还留着旧走向，或这个关系映射的是邻线延伸）"
        )
    if bad:
        return "⛔", "、".join(bad)
    if frac > 0.05:
        warn.append(f"断口 {frac * 100:.0f}%")
    if cov is not None and abs(cov - 1) > 0.15:
        warn.append(f"覆盖 {cov * 100:.0f}%")
    if warn:
        return "⚠️", "、".join(warn)
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
    ap.add_argument("--max-coverage", type=float, default=MAX_COVERAGE,
                    help="实走里程/官方里程 高于它就判定不可用（默认 1.30，"
                         "拦「关系映射的不是这条线」这类旧走向；传 0 关掉这道闸）")
    ap.add_argument("--max-gap-frac", type=float, default=MAX_GAP_FRAC,
                    help="断口占比高于它就判定不可用")
    ap.add_argument("--keep-bad", action="store_true",
                    help="判定 ⛔ 的也照样导出（默认跳过，避免半条线冒充整条）")
    ap.add_argument("--keep-parallel", action="store_true",
                    help="保留并联段（两端接回主线的替代支线）。默认剔除，"
                         "否则实走里程会比官方还长")
    ap.add_argument("--bridge", type=float, default=0.0, metavar="M",
                    help="把最近端点相距 ≤M 米的两段用直线接起来（默认 0 = 不接）。"
                         "只对几十~几百米的小断口有意义（那种多半是 OSM 漏画了路口一小截）；"
                         "公里级的断口是真没数据，别拿直线去填。接出来的那段是直线，"
                         "会在报表与 GeoJSON 里写明米数")
    ap.add_argument("--dump-raw", help="把 Overpass 原始响应存到这个文件（离线排查用）")
    ap.add_argument("--cache-dir", default=None,
                    help="把每次 Overpass 响应按查询哈希缓存到该目录，重跑直接读盘。"
                         "Overpass 公共实例经常 504/429，调参时不用每轮都赌一次网络")
    ap.add_argument("--offline", action="store_true",
                    help="只读 --cache-dir，绝不联网。缓存缺哪条就报哪条")
    ap.add_argument("--reuse-dir", default=None,
                    help="relation 侧几何从该目录下已有的 olle-<编号>.geojson 读，"
                         "**跳过 relations 查询**（散 way 照常查）。续跑 / Overpass 挂掉时用，"
                         "典型值 tracks/osm。注意它复用的是上次那份快照，不是 OSM 最新")
    ap.add_argument("--broad", action="store_true",
                    help="额外列出框里所有 hiking 关系（含名字没匹配上的），"
                         "用来确认「还差的编号」是 OSM 真没有还是没匹配上")
    ap.add_argument("--gpx", default=None, metavar="FILE",
                    help="额外的第三数据源：一个**按课程分段**的 GPX（每段 <trk> 的名字就是编号，"
                         "如 `KML Merge_Jeju Olle 12`）。OSM 里 12/13/14/15/17/21 这些没编关系的线"
                         "就靠它。仍然和 OSM 逐条比选，谁更可信用谁")
    ap.add_argument("--dry", action="store_true", help="只报告，不写文件")
    args = ap.parse_args()

    # 变体编号 → 主线编号的**默认**映射（--alias 可在其后覆盖/追加）。
    # OSM 与 GPX 把 3 线拆成 3-A / 3-B 两种走法，而官方只列一条「03」：
    #   3-A 是主线走向（GPX 22.34km / 107%，与 OSM 关系的 22.71km / 109% 同一走法、0 断口）；
    #   3-B 是缩短走法（14.84km / 71%），不并进来 —— 并进来只会多一个必然落选的候选。
    alias = dict(DEFAULT_ALIAS)
    alias.update(a.split("=", 1) for a in args.alias if "=" in a)
    reused = load_reused(args.reuse_dir) if args.reuse_dir else {}
    places, spec_ends = load_official_endpoints(
        os.path.join(ROOT, "src", "lib", "seed.ts"))
    if places:
        print(f"官方 GPS 端点：{'、'.join(f'{k}' for k in sorted(places))} "
              f"（用来卡「走向对不上」——里程对了不代表走的对）\n")

    def fetch(query, retries_hint=""):
        return cached_overpass(args.endpoint, query, args.cache_dir, args.offline)

    if args.reuse_dir:
        print(f"--reuse-dir {args.reuse_dir}：复用本地已有的 {len(reused)} 条几何 "
              f"（{'、'.join(sorted(reused)) or '（空）'}）")
        print("  → **跳过 relations 查询**。想按 OSM 最新重抓就别传这个参数。\n")
        data = {"elements": [], "remark": None}
    else:
        print(f"查询 Overpass：{args.endpoint}")
        print(f"范围 {BBOX}，匹配 name/ref/network 含「올레」或「Olle」的 route 关系\n")
        try:
            data = fetch(build_query(with_children=True))
        except QueryRejected as err:
            # 降级：这个 endpoint 不认 `rel(br.r)`。**不能就此认命** ——
            # 子关系里那些名字没含「올레/Olle」的会静默消失（里程偏短 + 断口巨大）。
            # 先跑不带子关系的查询，再从结果里读出「被引用但没取回」的子关系 id，精确补一次。
            print(f"⚠️ 该 endpoint 不支持 rel(br.r)（{err}），改用「先取父、再按 id 补子关系」。")
            data = fetch(build_query(with_children=False))
    if args.dump_raw:
        with open(args.dump_raw, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        print(f"原始响应已存：{args.dump_raw}")

    elements = dedupe_elements(data.get("elements", []))
    want = missing_child_ids(elements) if elements else []
    if want:
        print(f"补取子关系 {len(want)} 个（父关系引用了它们，但几何还没到手）……")
        for i in range(0, len(want), 40):
            chunk = want[i:i + 40]
            try:
                more = fetch(build_children_query(chunk))
            except QueryRejected as err:
                print(f"  ⚠️ 这批被拒（{err}），这 {len(chunk)} 个子关系会缺几何：{chunk}")
                continue
            elements.extend(more.get("elements", []))
        elements = dedupe_elements(elements)
    else:
        print("子关系无需补取（已随父关系一并取回）。")
    data = {"elements": elements, "remark": data.get("remark")}
    print()

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

    if args.broad and not args.reuse_dir:
        # 只回答一个问题：还差的那些编号，OSM 里**到底有没有**关系。
        # 正常查询靠 name/ref/network 命中，名字写法不同就漏；不带过滤再跑一遍，
        # 把「OSM 真没建」和「建了但名字没匹配上」彻底分开，省得靠猜。
        print("--broad：不带名字过滤再查一遍框内的 hiking 关系……")
        try:
            broad = fetch(build_broad_query())
            seen = {r["id"] for r in rels}
            others = []
            for e in broad.get("elements", []):
                if e.get("id") in seen:
                    continue
                t = e.get("tags") or {}
                others.append(
                    f"{(t.get('name') or t.get('name:en') or '（无名字）')}"
                    f"  [{t.get('type') or 'route'}"
                    f"/ref={t.get('ref') or '—'}/network={t.get('network') or '—'}]"
                    f"  relation {e.get('id')}"
                )
            if others:
                print(f"  框内还有 {len(others)} 个 hiking 关系没被名字规则命中：")
                for o in sorted(others)[:40]:
                    print(f"    - {o}")
                if len(others) > 40:
                    print(f"    …（还有 {len(others) - 40} 个）")
                print("  → 里面如果有你的编号，用 --alias 映射；否则就是 OSM 真没建这条。")
            else:
                print("  没有漏网的：框内所有 hiking 关系都已被名字规则命中。")
                print("  → 还差的那些编号在 OSM 里**确实没有关系**，只能换数据源。")
        except QueryRejected as err:
            print(f"  ⚠️ 被拒（{err}），跳过这一步。")
        print()

    # 同名关系可能重复（3코스 有 A/B 变体、有的线拆成两段），先全部解析再归并
    parsed = []
    for rel in parents:
        tags = rel.get("tags") or {}
        raw = code_from_name(tags.get("name") or tags.get("name:en") or "")
        code = alias.get(raw, raw)
        parsed.append((rel, tags, raw, code))

    # ---- 第二个数据源：名字里带编号的散 way ----
    # ⚠️ 这一步不能省，也**不能**用 --broad 的结论替代它。--broad 只回答「框里有没有
    #    别的 hiking **关系**」，答案是「没有」就以为 OSM 真没建这条线 —— 实测错得很远：
    #    12 / 13 / 14 / 15 / 14-1 在 OSM 里没有 relation，却有一堆带了名字的 way
    #    （`올레길 12`、`올레길 13`、`올레길 14 (Ollegil 14)`、`올레길15-A`…）。
    #    只查 relation 的后果就是：前端拿 seed.ts 的城镇级近似坐标连成一根斜穿岛内的
    #    直线 —— 地图上最刺眼的那处错误，而报表却写着「OSM 没建」。
    print("再查一次：名字里带「올레 / Olle」的道路 way（没有 relation 的线在这里）……")
    try:
        wdata = fetch(build_ways_query())
    except QueryRejected as err:
        print(f"  ⚠️ 被拒（{err}），本次只按 relation 处理。")
        wdata = {"elements": []}
    way_elements = wdata.get("elements", [])
    named_raw = named_ways(way_elements)
    if named_raw:
        print(f"  {len(way_elements)} 条 way →")
        for code in sorted({c for c, _ in named_raw}):
            byst = named_by_style(named_raw, code)
            print(f"     {code:<6} " + "、".join(
                f"{st}×{len(ws)}" for st, ws in sorted(byst.items())))
    else:
        print("  一条都没取回（换 --endpoint 镜像再试）。")
    print()

    # ---- 候选比选：同一个编号可能有四种来源 ----
    #   relation  — route relation 的成员 way（或 --reuse-dir 里那份上次的结果）
    #   ways-en   — 英文名 `Ollegil N` 的散 way（12/13/14/15 全靠它，通常最完整）
    #   ways-ko   — 韩文名 `올레길 N` 的散 way（覆盖零散，但别的编号可能靠它）
    #   both-xx   — relation **补上** 某一套散 way 里它缺的那几段（只补缺，不是取并集）
    # ⚠️ en / ko **绝不能合成一个候选**：两批 way 覆盖同一段路，合池就等于同段喂两遍。
    cands = {}   # code -> [(raw, src, label, ways, rel)]
    unmatched = []

    def add_cand(code, raw, src, label, ways, rel=None):
        if code and ways:
            cands.setdefault(code, []).append((raw, src, label, ways, rel))

    merge_skipped = []

    def add_merge(code, raw, src, label, ways, rel, base_km):
        """加一个「base + 补缺」候选，但**先验一条不变量：合并结果不能比 base 短**。

        ⚠️ 这条不变量是必须的：把补缺片段和 base 一起重缝时，缝合器可能反过来把
        base 的一部分也判成「并联段」剔掉 —— 表现就是「补缺之后反而少了几公里」。
        实测 04：relation 19.01km ✅ → both-gpx 只剩 16.89km，而它因为「断口更少」
        还赢了比选。补缺可以少断口，**绝不能少路**。
        """
        segs, _, _ = join_ways(ways, args.join_tol, args.keep_parallel)
        merged_km = sum(path_len_m(s) for s in segs) / 1000
        if merged_km < base_km - 0.05:
            merge_skipped.append(
                f"{code}: 放弃 {src} 补缺 —— 合并后只剩 {merged_km:.2f}km，"
                f"比原来的 {base_km:.2f}km 还短（补缺片段把原几何挤掉了一部分）")
            return
        add_cand(code, raw, src, label, ways, rel)

    for rel, tags, raw, code in parsed:
        nm = tags.get("name") or tags.get("name:en") or f"relation {rel['id']}"
        if not code:
            unmatched.append(nm)
            continue
        add_cand(code, raw, "relation", nm, ways_of(rel, rel_index), rel)

    # --reuse-dir：relation 侧直接用手上那份几何，省一次大查询
    for code in sorted(reused):
        ways, rel_like = reused[code]
        add_cand(code, code, "relation", f"复用的 olle-{code}.geojson（{len(ways)} 段）",
                 ways, rel_like)

    # 编号 → [(原名编号, 命名习惯)]：--alias 把 OSM 编号映射到你的编号时，
    # 分组必须按**原名**取，否则 alias 之后就查不到了。
    by_mapped = {}
    for (orig, st) in named_raw:
        by_mapped.setdefault(alias.get(orig, orig), []).append((orig, st))

    # ---- 第三数据源：按课程分段的 GPX（--gpx）----
    gpx_courses = {}
    gpx_by_mapped = {}
    if args.gpx:
        gpx_courses = read_course_gpx(args.gpx)
        print(f"--gpx {args.gpx}：{len(gpx_courses)} 条课程轨迹 → "
              + "、".join(sorted(gpx_courses)))
        missing_gpx = [c for c in ROUTE_CODES if c not in gpx_courses]
        if missing_gpx:
            print(f"  （这个 GPX 里没有：{'、'.join(missing_gpx)} —— 多半是离岛航线）")
        print()
        # ⚠️ 每个 GPX 段**各算一个候选**，不要按 alias 合并成一个池子：
        #    `3A` / `3B` 是同一条线的两种走法，合成一个池子缝就是在缝两条路。
        #    用 --alias 03-A=03 只影响「归到哪个编号」，比选交给打分。
        for orig, ws in gpx_courses.items():
            gpx_by_mapped.setdefault(alias.get(orig, orig), []).append((orig, ws))
        # ⚠️ 下面一律用 gpx_by_mapped（已过 alias），**不要**再碰 gpx_courses ——
        #    之前在这里查 gpx_courses，只要 alias 改过名字（03-A→03）就永远查不到，
        #    GPX 候选会凭空消失，报表上还看不出是这儿丢的。
        mapped_gpx = set(gpx_by_mapped)
        still = [c for c in ROUTE_CODES if c not in mapped_gpx]
        if still:
            print(f"  （映射后仍没有的编号：{'、'.join(still)} —— 多半是离岛航线）")

    for code in sorted(set(by_mapped) | set(gpx_by_mapped)):
        byst = {}
        for orig, st in by_mapped.get(code, ()):
            if st == "?":
                add_cand(code, code, "ways-?",
                         f"名字认得出编号但认不出语言：{len(named_raw[(orig, st)])} 条",
                         named_raw[(orig, st)])
                continue
            byst.setdefault(st, []).extend(named_raw[(orig, st)])
        for st, ws in sorted(byst.items()):
            add_cand(code, code, f"ways-{st}", f"{st} 名 {len(ws)} 条 way", ws)

        gpx_items = gpx_by_mapped.get(code, ())
        for orig, ws in sorted(gpx_items):
            if len(ws) == 1:
                add_cand(code, code, "gpx", f"GPX 里的「{orig}」段（1 段）", ws)
            else:
                for k, one in enumerate(ws):
                    add_cand(code, code, f"gpx:{orig}",
                             f"GPX 里的「{orig}」第 {k+1} 段", [one])

        # 补缺候选：relation + 「它没有的那几段」。**逐套分别做，不混池** ——
        # 同一段路在两套命名 / GPX 里各有一份，混起来缝就会重复。
        rel_items = [c for c in cands.get(code, []) if c[1] == "relation"]
        if not rel_items:
            continue
        rel_ways = [w for c in rel_items for w in c[3]]
        rel_obj = rel_items[0][4]
        base_segs, _, _ = join_ways(rel_ways, args.join_tol, args.keep_parallel)
        base_km = sum(path_len_m(s) for s in base_segs) / 1000
        for st, ws in sorted(byst.items()):
            extra = uncovered_ways(ws, base_segs)
            if extra:
                add_merge(code, code, f"both-{st}",
                          f"relation {len(rel_ways)} 段 + 补缺 {st} 名 {len(extra)} 条",
                          rel_ways + extra, rel_obj, base_km)
        for orig, ws in sorted(gpx_items):
            for one in ws:
                extra = uncovered_ways([one], base_segs)
                if extra:
                    add_merge(code, code, f"both-gpx:{orig}",
                              f"relation {len(rel_ways)} 段 + 补缺 GPX「{orig}」{len(extra)} 段",
                              rel_ways + extra, rel_obj, base_km)

    if args.only:
        want_codes = set(args.only)
        cands = {c: v for c, v in cands.items() if c in want_codes}

    print(f"{'来源编号':<9} {'归到':<6} {'来源':<10} {'way':>4} {'点':>5} {'段':>3} "
          f"{'实走km':>7} {'覆盖':>6} {'断口':>9} {'判定':<4} 名称")
    print("-" * 122)

    out, notes, skipped = {}, [], []

    # 判定档位越靠前越优先；同为可用时**断口总长**小的赢（地图上最直观、也是这次的痛点），
    # 再平手才比「覆盖更接近官方」。⚠️ 千万不要只比里程长短 —— 更长的那个很可能
    # 只是混进了替代支线或邻线延伸，那正是 07 被判 ⛔ 的原因。
    RANK = {"✅": 0, "⚠️": 1, "⛔": 2, "—": 3}

    for code in sorted(cands):
        rows = []
        for raw, src, label, ways, rel in cands[code]:
            segments, gaps, stats = join_ways(ways, args.join_tol, args.keep_parallel,
                                              args.bridge)
            km = sum(path_len_m(s) for s in segments) / 1000
            gap_m = sum(g["m"] for g in gaps)
            off = OFFICIAL_KM.get(code)
            cov = (km / off) if off else None
            if code in ROUTE_CODES:
                mark, why = verdict_of(km, gap_m, off, args.min_coverage,
                                       args.max_gap_frac, args.max_coverage)
                # 里程过关 ≠ 走向过关：再拿官方 GPS 端点卡一次（见 endpoint_verdict）
                if mark != "⛔":
                    ok, ewhy = endpoint_verdict(segments, spec_ends.get(code), places)
                    if not ok:
                        mark = "⛔"
                        why = (why + "；" if why else "") + ewhy
            else:
                # 编号不在这 27 条里 → 不判定，别显示出「✅ 可用」却又进不了产物
                mark, why = "—", ""
            rows.append({
                "raw": raw, "src": src, "label": label, "rel": rel, "ways": ways,
                "segments": segments, "gaps": gaps, "stats": stats,
                "km": km, "gap_m": gap_m, "cov": cov, "mark": mark, "why": why,
                "npts": sum(len(s) for s in segments),
            })

        def _rank(r):
            return (RANK.get(r["mark"], 3), round(r["gap_m"], 1),
                    abs((r["cov"] or 1.0) - 1.0))

        best = min(rows, key=_rank)
        multi = len(rows) > 1
        for r in sorted(rows, key=_rank):
            cov_txt = f"{r['cov'] * 100:.0f}%" if r["cov"] else "—"
            gap_col = f"{len(r['gaps'])}/{r['gap_m'] / 1000:.1f}km" if r["gaps"] else "—"
            src_col = ("*" if (multi and r is best) else " ") + r["src"]
            print(
                f"{r['raw'] or '—':<9} {code or '—':<6} {src_col:<10} {len(r['ways']):>4} "
                f"{r['npts']:>5} {len(r['segments']):>3} {r['km']:>7.2f} "
                f"{cov_txt:>6} {gap_col:>9} {r['mark']:<4} {r['label']}"
            )

        if multi:
            notes.append(
                f"{code}: 有 {len(rows)} 个来源，**选了 {best['src']}**"
                f"（{best['km']:.2f}km、断口 {best['gap_m'] / 1000:.2f}km、{best['mark']}）；"
                "落选的是 "
                + "；".join(
                    f"{r['src']} {r['km']:.2f}km/断口 {r['gap_m'] / 1000:.2f}km/{r['mark']}"
                    for r in sorted(rows, key=_rank) if r is not best
                )
            )

        raw, rel = best["raw"], best["rel"]
        segments, gaps, stats = best["segments"], best["gaps"], best["stats"]
        km, gap_m, mark, why = best["km"], best["gap_m"], best["mark"], best["why"]
        if rel is not None:
            kinds, role_txt = members_summary(rel, rel_index)
        else:
            kinds, role_txt = {"way": len(best["ways"]), "rel": 0, "node": 0}, ""
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
        if stats["bypass"]:
            extra.append(f"跳过闭合旁路 {stats['bypass']}")
        if stats["near"]:
            extra.append(f"就近接上 {stats['near']} 处/共 {stats['nearM']:.0f}m")
        if stats["spurDropped"]:
            extra.append(f"丢弃支线 {stats['spurDropped'] / 1000:.2f}km")
        if stats.get("bridgedN"):
            extra.append(
                f"小断口直线桥接 {stats['bridgedN']} 处/共 {stats['bridgedM']:.0f}m"
                "（这几段是直线，不是实测轨迹，GeoJSON 里已注明）"
            )
        if detail or extra:
            notes.append(f"{raw or '—'}: " + "，".join(detail + extra))
        if len(gaps) > 1:
            worst = sorted(gaps, key=lambda g: -g["m"])[:3]
            notes.append(
                f"{raw or '—'}: 最大的几个断口 —— "
                + "；".join(f"{g['m'] / 1000:.2f}km @ {g['from'][1]:.4f},{g['from'][0]:.4f}" for g in worst)
            )
        # 多段时把**每段多长**列出来：这是解释「为什么比官方长」的唯一线索
        if len(segments) > 1:
            seg_txt = "、".join(
                f"{i['km']:.2f}km" + ("（两端接回主线）" if i["both"] else "")
                for i in stats["segInfo"]
            )
            notes.append(f"{raw or '—'}: 分段明细 —— {seg_txt}")
        if stats.get("parallelN"):
            act = "已剔除" if stats.get("parallelDropped") else "按 --keep-parallel 保留了"
            notes.append(
                f"{raw or '—'}: {act} {stats['parallelN']} 段**并联段**共 "
                f"{stats['parallelM'] / 1000:.2f}km（两端都挂回主线 = 替代支线/同段走两遍，"
                "不是缺口续段）。实走里程因它而虚高，剔掉后才跟官方对得上。"
            )
        # 折返/绕环：藏在**同一段内部**，剔不掉。这是「剔完并联段还比官方长」的唯一解释，
        # 也是判断缝合是否走岔了的直接证据（07 就是这一类）。
        if stats.get("loopN"):
            notes.append(
                f"{raw or '—'}: ⚠️ 段内有 {stats['loopN']} 处**折返/绕环**共 "
                f"{stats['loopM'] / 1000:.2f}km（同一节点被走了两次）。"
                "这不是并联段、剔不掉：要么这条线在 OSM 里本就含往返段（如观景台来回），"
                "要么缝合在岔路口走岔了又走回来 —— 对着地图看一眼就能分清。"
            )

        if code not in ROUTE_CODES:
            unmatched.append(
                f"{best['label']}（推出 {raw}，不在 27 条里；"
                f"要用就 --alias {raw}={ROUTE_CODES[0]} 之类显式指定）"
            )
            continue

        if code in SKIP and not args.keep_bad:
            skipped.append(
                f"{code} （{SKIP[code]}）—— 选中的是 {best['src']}，不导出，"
                "这条线保持原来的近似坐标（宁可缺、不可假）"
            )
            continue
        if mark == "⛔" and not args.keep_bad:
            skipped.append(
                f"{code} （{why}）—— 选中的是 {best['src']}，不导出，"
                "这条线保持原来的近似坐标（宁可缺、不可假）"
            )
            continue
        out[code] = geojson_for(code, rel, segments, gaps, km,
                                best["src"], len(best["ways"]),
                                (stats.get("bridgedN", 0), stats.get("bridgedM", 0.0)))
        if mark == "⚠️":
            notes.append(f"{code} 已导出但请留意：{why}")

    if merge_skipped:
        notes.append("放弃的「补缺」候选（合并后反而更短，说明补缺片段把原几何挤掉了一段）：")
        notes.extend(f"  {m}" for m in merge_skipped)

    print()
    got = [c for c in ROUTE_CODES if c in out]
    missing = [c for c in ROUTE_CODES if c not in out]
    print(f"拿到 {len(got)}/{len(ROUTE_CODES)} 条：{'、'.join(got) if got else '（无）'}")
    if skipped:
        print("\n⛔ 判定不可用、没有导出（保持原来的近似坐标；"
              "半条线、或走向对不上的线，都不拿来冒充）：")
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
