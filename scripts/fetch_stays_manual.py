#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把人工核对并核对的公开住宿（scripts/data/curated_stays.json）合并进 src/data/stays.json。

为什么要有这个脚本：
- 数据源合规红线 —— 不抓 OTA（携程 / Airbnb / Booking / Agoda 等），其 ToS 明文禁止
  bot / 爬虫收集数据、禁止规避技术保护措施，且本项目 MIT 开源、数据随仓库再分发，
  风险比自用高得多。所以缺失的知名住宿只能靠「人工整理并核对的公开信息」补。
- 这条酒店（济州托维斯公寓 / 제주토비스콘도미니엄）本就在 OSM 库里，但被重复映射成
  4 条（涯月 3 条 + 翰林 1 条，两簇坐标相差约 460m），且缺中文 / 英文 / 地址 / 电话。
- 本脚本是「合并」而非「注入」：与 fetch_stays_tourapi.py / fetch_stays_kakao.py 同构，
  跑在它们之后，把所有匹配 matchKeys 的既有条目删掉（去重），再补一条规范、带官方名标记的
  条目进最近的城镇。幂等：重跑若干次结果一致；即便 fetch_stays.py 全量重抓把重复又带回来，
  重跑本脚本也会再次去重 + 补回规范条目。

合并规则（每条 curated 酒店）：
- 遍历所有城镇，删掉 name 命中任一 matchKeys（大小写不敏感子串）的既有条目（去重）。
- 按坐标找最近城镇，把规范条目 **prepend 到该镇 hotels 最前面**（人工补充的住宿置顶），
  刷新该镇 count。
- 规范条目带 nameZhOfficial / nameEnOfficial 标记，gen_stay_zh.py / gen_stay_en.py 会跳过它们，
  用户手填的中文 / 英文名不会被自动生成覆盖。

用法：
  python3 scripts/fetch_stays_manual.py          # 合并并落盘
  python3 scripts/fetch_stays_manual.py --dry    # 只打印将删除 / 将新增，不落盘
"""
import argparse
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "data", "stays.json")
CURATED = os.path.join(ROOT, "scripts", "data", "curated_stays.json")


def dist_m(lng1, lat1, lng2, lat2):
    if None in (lng1, lat1, lng2, lat2):
        return float("inf")
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (
        1 - math.cos((lng2 - lng1) * p)
    ) / 2
    return 12742000 * math.asin(math.sqrt(max(a, 0)))


def nearest_town(lng, lat, towns):
    best, bd = None, float("inf")
    for t in towns:
        c = t.get("center") or []
        if len(c) != 2:
            continue
        d = dist_m(lng, lat, c[0], c[1])
        if d < bd:
            best, bd = t, d
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="只打印将删除/新增，不落盘")
    args = ap.parse_args()

    curated = json.load(open(CURATED, encoding="utf-8"))
    d = json.load(open(SRC, encoding="utf-8"))
    towns = d.get("towns", [])

    removed, added = 0, 0
    # 先把每条 curated 转成规范 entry（不落盘）
    prepared = []
    for c in curated:
        keys = [k.lower() for k in c.get("matchKeys", [])]
        entry = {
            "id": c["id"],
            "name": c["name"],
            "nameZh": c.get("nameZh") or None,
            "nameEn": c.get("nameEn") or None,
            "nameRomaja": c.get("nameRomaja") or None,
            "note": c.get("note") or None,
            "address": c.get("address") or None,
            "phone": c.get("phone") or None,
            "website": c.get("website") or None,
            # 酒店介绍：打包真源里的默认介绍，前端用户改写会作为 override 存 localStorage 覆盖它
            "intro": c.get("intro") or None,
            "lng": round(float(c["lng"]), 6),
            "lat": round(float(c["lat"]), 6),
            "source": c.get("source", "manual"),
        }
        if c.get("nameZh"):
            entry["nameZhOfficial"] = True
        if c.get("nameEn"):
            entry["nameEnOfficial"] = True
        prepared.append((entry, keys))

    # 1) 去重：删掉所有命中 matchKeys 的既有条目（跨镇也删，修掉跨镇重复）
    for entry, keys in prepared:
        for t in towns:
            kept = []
            for h in t.get("hotels", []):
                nm = (h.get("name") or "").lower()
                hit = any(k in nm for k in keys)
                if hit:
                    removed += 1
                    continue
                kept.append(h)
            if len(kept) != len(t.get("hotels", [])):
                t["hotels"] = kept
                t["count"] = len(kept)

    # 2) 补规范条目进最近城镇，按城镇分组，整块 prepend 到该镇 hotels 最前面（人工补充置顶）
    by_town = {}
    for entry, _ in prepared:
        town = nearest_town(entry["lng"], entry["lat"], towns)
        if town is None:
            print(f"  [跳过] {entry['name']} 归不到任何城镇", file=__import__("sys").stderr)
            continue
        key = id(town)
        by_town.setdefault(key, {"town": town, "entries": []})["entries"].append(entry)

    for info in by_town.values():
        town, es = info["town"], info["entries"]
        town["hotels"] = es + town.get("hotels", [])
        town["count"] = len(town["hotels"])
        added += len(es)
        for e in es:
            print(f"  置顶新增 {e['name']} → {town['zh']}（{town['ko']}）")

    if args.dry:
        print(f"[dry] 将删除 {removed} 条重复，新增 {added} 条（置顶），未落盘")
        return 0

    d["towns"] = towns
    json.dump(d, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"删除重复 {removed} 条，置顶新增规范条目 {added} 条 → {SRC}")
    print("随后请重跑：python3 scripts/gen_stay_zh.py && python3 scripts/gen_stay_en.py")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
