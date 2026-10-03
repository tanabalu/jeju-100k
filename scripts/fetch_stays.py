#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
并行爬取济州偶来沿线城镇的住宿 POI（OpenStreetMap / Overpass API），
整理成与 src/types.ts 的 Hotel 结构对齐，写入 src/data/stays.json，
供前端 DataContext 的 mergeStays 叠加进各路线的 Route.hotels。

- 数据源：OSM 公开数据（ODbL），合规、带真实经纬度，无反爬。
- 价格/评分 OSM 没有 → 一律留空（遵守 stayMatch 的「不编造」纪律）。
- 并行：线程池并发查询多个沿线城镇。
- 韧性：每完成一个城镇立即增量落盘；--resume 可跳过已抓到的城镇继续补。
  这样即使被超时杀掉，已完成的城镇不会丢，下次续跑补齐即可。

用法：
  python3 scripts/fetch_stays.py                 # 全量（增量落盘）
  python3 scripts/fetch_stays.py --resume        # 只补缺失城镇
  python3 scripts/fetch_stays.py --dry           # 只查第一个城镇验证
"""
import argparse
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

# 多个公共 Overpass 端点，单个 504/超时自动换下一个（环境限流时提高成功率）。
# 只保留「全球数据」实例：区域镜像（如仅瑞士的 overpass.osm.ch）对济州恒返回 0 条元素，
# 会被当成成功写入空列表，导致城镇住宿假性为 0 —— 这是 stays.json 大面积空城镇的根因。
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]
TIMEOUT = 90
UA = "jeju-olle-stay-fetch/1.0 (Jeju Olle 100k guide; contact: local dev)"

TOURISM_RE = "^(hotel|guest_house|hostel|motel|apartment|chalet|camp_site)$"
SUBTYPE_ZH = {
    "hotel": "酒店",
    "guest_house": "民宿 / Guesthouse",
    "hostel": "青年旅舍",
    "motel": "汽车旅馆",
    "apartment": "公寓式住宿",
    "chalet": "度假小木屋",
    "camp_site": "露营地",
}

# 偶来沿线建议住宿城镇（来自 scripts/add_stay_return.py 的 RET 字典）；center=[lng,lat]，radiusM 覆盖镇区
TOWNS = [
    ("성산", "城山", 126.900, 33.460, 7000),
    ("제주시", "济州市", 126.490, 33.500, 7000),
    ("표선", "表善", 126.842, 33.326, 7000),
    ("남원", "南元", 126.720, 33.278, 7000),
    ("서귀포", "西归浦", 126.509, 33.249, 7000),
    ("대평리", "大坪里", 126.362, 33.237, 6000),
    ("화순", "和顺", 126.335, 33.240, 6000),
    ("모슬포", "摹瑟浦", 126.253, 33.219, 7000),
    ("하모", "咸摹", 126.270, 33.200, 5000),
    ("가파도", "加波岛", 126.271, 33.175, 3000),
    ("무릉", "武陵", 126.237, 33.275, 6000),
    ("저지", "楮旨", 126.256, 33.333, 6000),
    ("한림", "翰林", 126.262, 33.419, 7000),
    ("애월", "涯月", 126.300, 33.410, 7000),
    ("김녕", "金宁", 126.745, 33.557, 7000),
    ("추자도", "楸子岛", 126.296, 33.964, 6000),
    ("우도", "牛岛", 126.958, 33.493, 5000),
]

# code -> 建议住宿城镇（ko），来自 add_stay_return.py 的 RET 字典，用于把住宿挂到对应路线
ROUTE_TOWNS = {
    "01": ["성산", "제주시"],
    "01-1": ["우도"],
    "02": ["성산"],
    "03-A": ["표선", "성산"],
    "03-B": ["표선", "성산"],
    "04": ["남원", "서귀포"],
    "05": ["서귀포"],
    "06": ["서귀포"],
    "07": ["서귀포"],
    "07-1": ["서귀포"],
    "08": ["대평리", "서귀포"],
    "09": ["화순", "서귀포"],
    "10": ["모슬포", "하모"],
    "10-1": ["가파도", "모슬포"],
    "11": ["모슬포"],
    "12": ["무릉", "모슬포"],
    "13": ["저지", "한림"],
    "14": ["한림"],
    "14-1": ["한림", "저지"],
    "15-A": ["애월", "제주시"],
    "15-B": ["애월", "제주시"],
    "16": ["제주시", "애월"],
    "17": ["제주시"],
    "18": ["제주시"],
    "18-1": ["추자도"],
    "18-2": ["추자도"],
    "19": ["김녕", "제주시"],
    "20": ["김녕", "성산", "제주시"],
    "21": ["성산", "제주시"],
}


def build_ql(lat: float, lon: float, radius: int) -> str:
    return f"""[out:json][timeout:{TIMEOUT}];
(
  node["tourism"~"{TOURISM_RE}"](around:{radius},{lat},{lon});
  way["tourism"~"{TOURISM_RE}"](around:{radius},{lat},{lon});
);
out center tags;
"""


def fetch_one(ep_idx, town):
    """返回 elements 列表；所有端点都失败时返回 None（调用方据此不落盘，留给 --resume 补）。"""
    ko, zh, lng, lat, radius = town
    ql = build_ql(lat, lng, radius)
    last_err = None
    for ei in range(len(ENDPOINTS)):
        url = ENDPOINTS[(ep_idx[0] + ei) % len(ENDPOINTS)]
        try:
            data = urllib.parse.urlencode({"data": ql}).encode()
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read()).get("elements", [])
        except Exception as e:  # noqa
            last_err = e
            continue
    print(f"  [失败] {zh}({ko}): {last_err}", file=sys.stderr)
    return None


def to_hotel(e: dict):
    tags = e.get("tags") or {}
    sub = tags.get("tourism")
    if sub not in SUBTYPE_ZH:
        return None
    if e.get("type") == "node":
        lat, lon = e.get("lat"), e.get("lon")
    else:
        c = e.get("center") or {}
        lat, lon = c.get("lat"), c.get("lon")
    if not (isinstance(lat, (int, float)) and isinstance(lon, (int, float))):
        return None
    name = tags.get("name") or tags.get("name:en") or tags.get("name:ko")
    if not name:
        return None
    # 英文名只抄 OSM 的 name:en；name 本身是拉丁字母时它即为英文名。
    # 两者都没有就留空 —— 不翻译、不罗马转写（那是 scripts/gen_stay_zh.py 的 nameRomaja）。
    name_en = tags.get("name:en")
    if not name_en and re.fullmatch(r"[A-Za-z0-9\s&'\.\-]+", name.strip()):
        name_en = name
    road = tags.get("addr:road") or tags.get("addr:street")
    hn = tags.get("addr:housenumber")
    city = tags.get("addr:city") or tags.get("addr:suburb")
    if road or city:
        addr = road or ""
        if road and hn:
            addr = f"{road} {hn}"
        if city:
            addr = (addr + " " + city).strip() if addr else city
    else:
        addr = tags.get("addr:full")
    phone = tags.get("phone") or tags.get("contact:phone") or tags.get("tel")
    website = tags.get("website") or tags.get("contact:website") or tags.get("url")
    return {
        "id": f"osm_{e.get('type')}_{e.get('id')}",
        "name": name,
        "nameEn": name_en,
        "lng": round(float(lon), 6),
        "lat": round(float(lat), 6),
        "address": addr or None,
        "phone": phone or None,
        "website": website or None,
        "rating": None,
        "priceRange": None,
        "note": SUBTYPE_ZH[sub],
        "osmType": e.get("type"),
        "osmId": e.get("id"),
    }


def write_partial(results: dict, dest: str, done: int, total: int):
    """每完成一个城镇就增量落盘，超时也不丢已完成的部分。"""
    towns_out = []
    cnt = 0
    for ko, zh, lng, lat, radius in TOWNS:
        hs = results.get(ko)
        if hs is None:
            continue
        cnt += len(hs)
        towns_out.append({
            "ko": ko, "zh": zh,
            "center": [round(lng, 6), round(lat, 6)],
            "radiusM": radius, "count": len(hs),
            "hotels": hs,
        })
    out = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "OpenStreetMap Overpass API",
        "license": "© OpenStreetMap contributors, ODbL — https://www.openstreetmap.org/copyright",
        "note": "价格/评分 OSM 未提供，留空待用户在后台补充；不编造具体数值。",
        "partial": done < total,
        "towns": towns_out,
        "routeTowns": ROUTE_TOWNS,
    }
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="只查第一个城镇")
    ap.add_argument("--resume", action="store_true", help="跳过已抓到的城镇，只补缺失")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    dest = os.path.normpath(os.path.join(here, "..", "src", "data", "stays.json"))

    # 始终以磁盘已有数据为基底：write_partial 只输出 results 里有的城镇，
    # 不带基底跑 --dry 会把 stays.json 覆盖成只剩一个城镇。
    results: dict = {}
    if os.path.exists(dest):
        try:
            old = json.load(open(dest, encoding="utf-8"))
            for t in old.get("towns", []):
                if t.get("hotels"):
                    results[t["ko"]] = t["hotels"]
            print(f"[基底] 已载入 {len(results)} 个城镇的现有住宿")
        except Exception as e:  # noqa
            print(f"[基底] 读取失败，忽略：{e}", file=sys.stderr)

    if args.dry:
        pending = TOWNS[:1]
    elif args.resume:
        pending = [t for t in TOWNS if t[0] not in results]
        print(f"[resume] 待补 {len(pending)} 个城镇")
    else:
        pending = list(TOWNS)
    if not pending:
        print("全部城镇已抓取，无需补。")
        return

    ep_idx = [0]
    lock = threading.Lock()
    t0 = time.time()
    print(f"并行查询 {len(pending)} 个城镇（共 {len(TOWNS)}）…")
    with ThreadPoolExecutor(max_workers=min(2, len(pending))) as ex:
        futs = {ex.submit(fetch_one, ep_idx, t): t for t in pending}
        for fut in as_completed(futs):
            t = futs[fut]
            els = fut.result()
            if els is None:  # 全端点失败：不落盘，保持"未抓取"，下次 --resume 会补
                print(f"  {t[1]}({t[0]}): 未抓取（端点全部不可用）[{len(results)}/{len(TOWNS)}]")
                continue
            hotels = []
            seen = set()
            for e in els:
                h = to_hotel(e)
                if h and h["id"] not in seen:
                    seen.add(h["id"])
                    hotels.append(h)
            with lock:
                results[t[0]] = hotels
                done = len(results)
                write_partial(results, dest, done, len(TOWNS))
            print(f"  {t[1]}({t[0]}): {len(hotels)} 家（原始 {len(els)}）[{done}/{len(TOWNS)}]")

    total = sum(len(v) for v in results.values())
    dt = time.time() - t0
    print(f"完成：{len(results)}/{len(TOWNS)} 城镇 · {total} 家，耗时 {dt:.1f}s → {dest}")


if __name__ == "__main__":
    main()
