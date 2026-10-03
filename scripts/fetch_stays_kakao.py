#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 Kakao Local API 抓济州住宿（category_group_code=AD5），合并进 src/data/stays.json。

为什么需要它：OSM 缺中大型酒店（济州亚洲酒店在抓取半径内却没有），TourAPI 官方库
只有 49 条精选且没有亚洲酒店。Kakao 是韩国本土 POI 库，住宿收录最全。

## 授权与约束（Kakao Developers 运营政策，2026-10-02 查证）
- 配额：Local API 每日 100,000 次；本脚本全量约 400~1200 次请求，远在额度内。
- 缓存只能用于「改善本应用内的用户体验」，且须保持数据最新 —— 所以本脚本**必须可重跑刷新**：
  重跑按 place id 更新已有条目，不新增重复项。
- **只落最小事实字段**：名称 / 坐标 / 地址 / 电话 / 业态分类。
  价格、图片、评论、评分一律不取 —— 那是条款与隐私风险最高的部分，本应用也用不到。
- 条目标 `source=kakao`，README 需标注数据来源。
- 不做任何反爬对抗：这是官方 API，正常鉴权调用即可。

## 抓取方式
category 搜索单次最多返回 45 条（size≤15 × page≤3），济州市中心一个 5 km 圈里住宿远超 45 家，
所以按网格铺开，并对「返回 45 条」的格子递归四分细化，直到半径小于 R_MIN。
只做加法：所有格子结果按 place id 去重后合并。

用法：
  cp .env.example .env     # 填 KAKAO_REST_KEY
  python3 scripts/fetch_stays_kakao.py --dry          # 只抓一格，打印样本，不落盘
  python3 scripts/fetch_stays_kakao.py                # 全量抓取并合并
  # 注意：前端 seed 由 src/lib/seedStays.ts 从 src/data/stays.json 实时派生，无需再跑生成脚本

key 申请：https://developers.kakao.com/console/app → 新建应用 → REST API 키
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

from _env import load_env

BASE = "https://dapi.kakao.com/v2/local/search/category.json"
CATEGORY = "AD5"          # 住宿
SIZE = 15                 # 单页条数上限
MAX_PAGE = 3              # 单次查询最多 45 条
R_INIT = 5000             # 初始网格半径（米）
R_MIN = 800               # 细分到此为止
BBOX = (126.08, 33.20, 126.98, 33.60)   # 济州本岛 + 牛岛 / 加波岛一带
DUP_M = 150               # 与已有条目判为同一家的坐标距离
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "data", "stays.json")

# Kakao category_name 末段 → 业态中文。只作兜底，最终由 gen_stay_zh.py 按名称里的业态词重判。
CAT_ZH = [
    ("호텔", "酒店"), ("모텔", "汽车旅馆"), ("민박", "家庭民宿"), ("펜션", "民宿"),
    ("게스트하우스", "民宿"), ("리조트", "度假村"), ("콘도", "公寓式酒店"),
    ("캠핑", "露营地"), ("호스텔", "青年旅舍"), ("한옥", "韩屋住宿"),
    ("풀빌라", "民宿"), ("여관", "旅馆"), ("찜질방", "汗蒸房"), ("레지던스", "公寓式酒店"),
]


def m_to_deg(r_m: float, lat: float):
    """米 → 经纬度偏移。"""
    d_lat = r_m / 111320.0
    d_lng = r_m / (111320.0 * math.cos(math.radians(lat)))
    return d_lng, d_lat


def query(x: float, y: float, r: int, page: int, key: str):
    """调一次 category 搜索；返回 (documents, total_count, is_end)。"""
    q = {
        "category_group_code": CATEGORY,
        "x": f"{x:.6f}", "y": f"{y:.6f}",
        "radius": str(r), "page": str(page), "size": str(SIZE),
    }
    url = BASE + "?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(
        url, headers={"Authorization": f"KakaoAK {key}", "User-Agent": "jeju-olle-100k/1.0"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    docs = data.get("documents") or []
    meta = data.get("meta") or {}
    return docs, int(meta.get("total_count") or 0), bool(meta.get("is_end", True))


def note_of(category_name: str):
    tail = (category_name or "").split(">")[-1].strip()
    for kw, zh in CAT_ZH:
        if kw in tail:
            return zh
    return "住宿"


def to_hotel(d: dict, town_ko: str):
    try:
        lng, lat = float(d.get("x")), float(d.get("y"))
    except (TypeError, ValueError):
        return None
    name = (d.get("place_name") or "").strip()
    if not name:
        return None
    addr = (d.get("road_address_name") or "").strip() or (d.get("address_name") or "").strip()
    return {
        "id": f"kakao_{d.get('id')}",
        "name": name,
        "nameZh": None,          # 交给 gen_stay_zh.py（Kakao 不给中文名）
        "nameRomaja": None,
        "nameEn": None,          # 交给 gen_stay_en.py（只抄真实拉丁名）
        "lng": round(lng, 6),
        "lat": round(lat, 6),
        "address": addr or None,
        "phone": (d.get("phone") or "").strip() or None,
        "website": None,         # place_url 是 Kakao 地图页，不是官网，不填
        "rating": None,
        "priceRange": None,
        "note": note_of(d.get("category_name") or ""),
        "source": "kakao",
        "townKo": town_ko,
        "kakaoId": str(d.get("id")),
    }


def nearest_town(lng, lat, towns):
    best, best_d = None, None
    for t in towns:
        tlng, tlat = t.get("lng"), t.get("lat")
        if tlng is None or tlat is None:
            continue
        d = math.hypot((lng - tlng) * math.cos(math.radians(lat)), lat - tlat)
        if best_d is None or d < best_d:
            best, best_d = t, d
    return best, best_d


def in_bbox(lng, lat):
    return BBOX[0] <= lng <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="只抓济州市中心一格，打印样本，不落盘")
    ap.add_argument("--max-requests", type=int, default=4000, help="请求数上限，防止跑飞")
    args = ap.parse_args()

    n_env = load_env()
    if n_env:
        print(f"已从 .env 读取 {n_env} 个密钥")
    key = os.environ.get("KAKAO_REST_KEY")
    if not key:
        print(
            "缺 KAKAO_REST_KEY。复制 .env.example 为 .env 并填入，或 export KAKAO_REST_KEY=...\n"
            "申请：https://developers.kakao.com/console/app → 新建应用 → REST API 키",
            file=sys.stderr,
        )
        return 1

    stats = {"req": 0}

    def fetch(x, y, r):
        if stats["req"] >= args.max_requests:
            return [], 0, True
        for attempt in range(3):
            try:
                stats["req"] += 1
                out = query(x, y, r, 1, key)
                time.sleep(0.05)
                return out
            except Exception as e:  # noqa
                print(f"  [重试 {attempt + 1}/3] {r}m 格：{e}", file=sys.stderr)
                time.sleep(1 + attempt)
        print("  [放弃] 该格连续失败", file=sys.stderr)
        return [], 0, True

    if args.dry:
        docs, total, is_end = fetch(126.531, 33.499, 3000)
        print(f"济州市中心 3km：本页 {len(docs)} 条 / 共 {total} 条 / is_end={is_end}")
        for d in docs[:5]:
            print("   ", json.dumps(d, ensure_ascii=False)[:260])
        return 0

    seen = {}      # kakao id → hotel
    cells = 0

    def sweep(x: float, y: float, r: int, depth: int):
        """抓一格；结果满 45 条说明漏了，四分细化再来。"""
        nonlocal cells
        if stats["req"] >= args.max_requests:
            return
        cells += 1
        docs, total, is_end = fetch(x, y, r)
        page = 1
        while not is_end and page < MAX_PAGE:
            page += 1
            try:
                stats["req"] += 1
                more, total, is_end = query(x, y, r, page, key)
                docs = docs + more
                time.sleep(0.05)
            except Exception as e:  # noqa
                print(f"  [跳过第 {page} 页] {e}", file=sys.stderr)
                break
        for d in docs:
            pid = str(d.get("id"))
            if pid and pid not in seen:
                seen[pid] = d
        if total > len(docs) and r > R_MIN and depth < 6:
            d_lng, d_lat = m_to_deg(r / 2, y)
            for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
                nx, ny = x + sx * d_lng, y + sy * d_lat
                if in_bbox(nx, ny):
                    sweep(nx, ny, r // 2, depth + 1)

    d_lng, d_lat = m_to_deg(R_INIT, (BBOX[1] + BBOX[3]) / 2)
    lng = BBOX[0]
    while lng <= BBOX[2] + d_lng / 2:
        lat = BBOX[1]
        while lat <= BBOX[3] + d_lat / 2:
            sweep(lng, lat, R_INIT, 0)
            lat += d_lat
        lng += d_lng
    print(f"扫过 {cells} 个格子，发出 {stats['req']} 次请求，去重后 {len(seen)} 家")

    d = json.load(open(SRC, encoding="utf-8"))
    towns = d.get("towns", [])
    existing = [h for t in towns for h in t.get("hotels", [])]
    by_kid = {str(h.get("kakaoId")): h for h in existing if h.get("kakaoId")}

    added, merged, skipped = 0, 0, 0
    for pid, doc in seen.items():
        h = to_hotel(doc, None)
        if not h:
            skipped += 1
            continue
        town, _ = nearest_town(h["lng"], h["lat"], towns)
        if town is None:
            skipped += 1
            continue
        h["townKo"] = town.get("ko")
        old = by_kid.get(pid)
        if old is None:
            for e in existing:
                if e.get("lng") and e.get("lat"):
                    if math.hypot(
                        (h["lng"] - e["lng"]) * math.cos(math.radians(h["lat"])),
                        h["lat"] - e["lat"],
                    ) * 111320 < DUP_M:
                        old = e
                        break
        if old is not None:
            for k in ("address", "phone"):
                if h.get(k) and not old.get(k):
                    old[k] = h[k]
            # 每次都按最新分类刷新，重跑可自愈（运营政策要求缓存保持最新）
            old["note"] = h["note"]
            old["source"] = "kakao"
            old["kakaoId"] = pid
            merged += 1
            continue
        town.setdefault("hotels", []).append(h)
        added += 1

    d["towns"] = towns
    d.setdefault("sources", [])
    if "kakao" not in d["sources"]:
        d["sources"].append("kakao")
    json.dump(d, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"新增 {added} 家，合并进已有条目 {merged} 家，跳过 {skipped} 家")
    print("落盘后请重跑：python3 scripts/gen_stay_zh.py && python3 scripts/gen_stay_en.py")
    print("（前端 seed 由 src/lib/seedStays.ts 自动从 src/data/stays.json 派生，重新构建即可）")


if __name__ == "__main__":
    sys.exit(main())
