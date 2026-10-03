#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从韩国观光公社 TourAPI 抓济州住宿，合并进 src/data/stays.json（与现有 OSM 数据去重）。

为什么要有这个脚本：OSM 是志愿者数据，济州的小民宿录得很密，中大型酒店反而经常没有
（济州亚洲酒店就在抓取半径内却不在库里）。TourAPI 是韩国官方旅游数据，住宿经过登记审核。

实测覆盖（2026-10-02，济州 areaCode=39 / contentTypeId=32）：
- 韩文 KorService2 住宿 **只有 49 条**，专用接口 searchStay2 也是 49 条 —— 官方库收录的
  是精选住宿，不是全量。含金量在「大牌」：그랜드 하얏트 제주 / 제주신라호텔 / 신라스테이 /
  서귀포칼호텔 等原本库里没有的都在这里面，但用户点名的 제주아시아호텔 依然不在。
- 简中 ChsService2 / 英文 EngService2 **不含住宿**（全国 contentTypeId=32 的 totalCount 都是 0，
  而济州全类型只有 171 / 163 条）。所以**拿不到官方中文名与英文名**，本脚本只在真的取到时
  才写 nameZh / nameEn 并打 nameZhOfficial / nameEnOfficial 标记；其余条目的中文名仍由
  gen_stay_zh.py 按既有口径生成。

数据源与端点（TourAPI 4.0，各语言是独立数据集，key 要分别申请）：
  韩文 KorService2  https://www.data.go.kr/data/15101578/openapi.do
  简中 ChsService2  https://www.data.go.kr/data/15101764/openapi.do
  英文 EngService2  https://www.data.go.kr/data/15101753/openapi.do
  端点 https://apis.data.go.kr/B551011/<Svc>/areaBasedList2
  必需参数 serviceKey / MobileOS / MobileApp / _type=json
  住宿 contentTypeId=32，济州 areaCode=39（济州市 sigunguCode=4、西归浦 5）

密钥（不进 git）：
  cp .env.example .env      # .env 已在 .gitignore，只在本机
  # 然后填 TOURAPI_KEY_KOR / _CHS / _ENG
也可以不建文件，直接 export 同名环境变量（export 的优先于 .env）。

用法：
  python3 scripts/fetch_stays_tourapi.py --dry    # 只抓第一页，打印样本，不落盘
  python3 scripts/fetch_stays_tourapi.py          # 全量抓取并合并落盘

合并规则：
- 与现有条目按坐标距离 < DUP_M 判定为同一家：不新增，只把官方中文名 / 英文名 /
  地址 / 电话 / 官网补到已有条目上，并标 source=tourapi。
- 坐标不在任何现有条目附近的，作为新条目加入，归入距离最近的城镇。
- source=tourapi 的条目自带官方名称，scripts/gen_stay_zh.py 与 gen_stay_en.py 会跳过它们，
  不会被自动生成的中译 / 罗马音覆盖。
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://apis.data.go.kr/B551011/{svc}/areaBasedList2"
MOBILE_OS = "ETC"
MOBILE_APP = "jeju-olle-100k"
AREA_CODE = "39"          # 济州特别自治道
CONTENT_TYPE_STAY = "32"  # 住宿
ROWS = 100
DUP_M = 150               # 与现有条目判定为同一家的坐标距离阈值
from _env import load_env

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "data", "stays.json")

# TourAPI 住宿 cat3 → 业态中文。只用官方 cat3 作兜底：
# 这批条目的 note 最终由 gen_stay_zh.py 按名称里的业态词重判（项目一贯口径），
# cat3 只在名称里没有业态词时才生效，所以看不准的类别一律写宽泛词。
#
# 下表是拿济州实测的 49 条反推校准的（2026-10-02），不是照文档抄的：
#   B02010100 = 관광호텔     그랜드 하얏트 제주 / 제주신라호텔 / 신라스테이 等 13 条全是 호텔·리조트
#   B02010500 = 리조트       아덴힐리조트&골프 / 타미우스골프&빌리지
#   B02010700 = 펜션         아망뜨펜션 / 보물섬펜션 / 앙끄리에펜션 等 12 条全是 펜션·독채
#   B02010900 = 호텔         제주알(R)호텔 / 포도호텔（曾被误判成「韩屋住宿」）
#   B02011100 = 기타 숙박    18 条是 호텔/리조트/호스텔 混合，不细分，写「住宿」
CAT3_ZH = {
    "B02010100": "酒店", "B02010200": "公寓式酒店", "B02010300": "民宿",
    "B02010400": "青年旅舍", "B02010500": "度假村", "B02010600": "住宿",
    "B02010700": "民宿", "B02010800": "露营地", "B02010900": "酒店",
    "B02011000": "民宿", "B02011100": "住宿", "B02011200": "胶囊旅馆",
    "B02011300": "民宿", "B02011400": "水上住宿", "B02011500": "寺庙住宿",
    "B02011600": "豪华露营", "B02011700": "汽车营地",
}


def get_page(svc: str, key: str, page: int):
    """抓一页；返回 (items, totalCount)。失败抛异常由调用方处理。"""
    q = {
        "serviceKey": key,
        "MobileOS": MOBILE_OS,
        "MobileApp": MOBILE_APP,
        "_type": "json",
        "areaCode": AREA_CODE,
        "contentTypeId": CONTENT_TYPE_STAY,
        "numOfRows": str(ROWS),
        "pageNo": str(page),
    }
    url = BASE.format(svc=svc) + "?" + urllib.parse.urlencode(q, safe="%")
    req = urllib.request.Request(url, headers={"User-Agent": "jeju-olle-100k/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    # 平台级错误（key 无效 / 未申请）不走 response 信封，而是 OpenAPI_ServiceResponse
    if "OpenAPI_ServiceResponse" in data:
        raise RuntimeError("平台返回错误响应（key 无效或未申请该数据集？）")
    body = (data.get("response") or {}).get("body") or {}
    head = (data.get("response") or {}).get("header") or {}
    code = head.get("resultCode")
    if code != "0000":
        raise RuntimeError(f"resultCode={code} resultMsg={head.get('resultMsg')}")
    items = ((body.get("items") or {}).get("item")) or []
    if isinstance(items, dict):
        items = [items]
    return items, int(body.get("totalCount") or 0)


def fetch_all(svc: str, key: str, label: str):
    """翻页抓全量；返回 list[item]。"""
    out = []
    page = 1
    total = None
    while True:
        for attempt in range(3):
            try:
                items, total = get_page(svc, key, page)
                break
            except Exception as e:  # noqa
                print(f"  [重试 {attempt + 1}/3] {label} 第 {page} 页：{e}", file=sys.stderr)
                time.sleep(2 + attempt * 2)
        else:
            print(f"  [放弃] {label} 第 {page} 页连续失败，已抓 {len(out)} 条", file=sys.stderr)
            break
        if not items:
            break
        out.extend(items)
        print(f"  {label} 第 {page} 页 +{len(items)}（累计 {len(out)}/{total}）")
        if len(items) < ROWS or (total and len(out) >= total):
            break
        page += 1
        time.sleep(0.4)
    return out


def fnum(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def dist_m(lng1, lat1, lng2, lat2):
    """两点球面距离（米），够用来判断是不是同一家。"""
    if None in (lng1, lat1, lng2, lat2):
        return float("inf")
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (
        1 - math.cos((lng2 - lng1) * p)
    ) / 2
    return 12742000 * math.asin(math.sqrt(max(a, 0)))


def to_hotel(item: dict, zh: str, en: str, town_ko: str):
    cid = item.get("contentid")
    lng = fnum(item.get("mapx"))
    lat = fnum(item.get("mapy"))
    name = (item.get("title") or "").strip()
    if not (name and lng and lat):
        return None
    addr = " ".join(x for x in [item.get("addr1"), item.get("addr2")] if x).strip() or None
    cat3 = item.get("cat3") or ""
    h = {
        "id": f"tourapi_{cid}",
        "name": name,
        "nameZh": zh or None,
        "nameRomaja": None,
        "nameEn": en or None,
        "lng": round(lng, 6),
        "lat": round(lat, 6),
        "address": addr,
        "phone": (item.get("tel") or "").strip() or None,
        "website": None,
        "rating": None,
        "priceRange": None,
        "note": CAT3_ZH.get(cat3) or "住宿",
        "source": "tourapi",
        "townKo": town_ko,
        "contentId": str(cid),
    }
    # 拿到官方外语名才打标记：gen_stay_zh.py / gen_stay_en.py 只认这个标记，
    # 其余条目仍走「地名意译 + 业态中译」的自动生成，重跑可刷新
    if zh:
        h["nameZhOfficial"] = True
    if en:
        h["nameEnOfficial"] = True
    return h


def nearest_town(lng, lat, towns):
    best, bd = None, float("inf")
    for t in towns:
        c = t.get("center") or []
        if len(c) != 2:
            continue
        d = dist_m(lng, lat, c[0], c[1])
        if d < bd:
            best, bd = t, d
    return best, bd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="只抓第一页并打印样本，不落盘")
    args = ap.parse_args()

    n_env = load_env()
    if n_env:
        print(f"已从 .env 读取 {n_env} 个密钥")

    key_kor = os.environ.get("TOURAPI_KEY_KOR")
    key_chs = os.environ.get("TOURAPI_KEY_CHS")
    key_eng = os.environ.get("TOURAPI_KEY_ENG")
    if not key_kor:
        print(
            "缺 TOURAPI_KEY_KOR。复制 .env.example 为 .env 并填入 key，或 export TOURAPI_KEY_KOR=...\n"
            "申请：https://www.data.go.kr/data/15101578/openapi.do",
            file=sys.stderr,
        )
        return 1

    print("抓韩文主数据（KorService2）…")
    if args.dry:
        items, total = get_page("KorService2", key_kor, 1)
        print(f"首页 {len(items)} 条 / 共 {total} 条；样本：")
        for it in items[:3]:
            print("   ", json.dumps(it, ensure_ascii=False)[:300])
        return 0
    kor = fetch_all("KorService2", key_kor, "Kor")
    print(f"韩文主数据 {len(kor)} 条")

    zh_map, en_map = {}, {}
    if key_chs:
        print("抓官方中文名（ChsService2）…")
        for it in fetch_all("ChsService2", key_chs, "Chs"):
            zh_map[str(it.get("contentid"))] = (it.get("title") or "").strip()
    else:
        print("未设 TOURAPI_KEY_CHS，跳过官方中文名")
    if key_eng:
        print("抓官方英文名（EngService2）…")
        for it in fetch_all("EngService2", key_eng, "Eng"):
            en_map[str(it.get("contentid"))] = (it.get("title") or "").strip()
    else:
        print("未设 TOURAPI_KEY_ENG，跳过官方英文名")

    d = json.load(open(SRC, encoding="utf-8"))
    towns = d.get("towns", [])
    existing = [h for t in towns for h in t.get("hotels", [])]
    # 已有条目里的 tourapi 来源按 contentId 记下来，重跑时更新而不新增
    by_cid = {str(h.get("contentId")): h for h in existing if h.get("contentId")}

    added, merged, skipped = 0, 0, 0
    for it in kor:
        cid = str(it.get("contentid"))
        lng, lat = fnum(it.get("mapx")), fnum(it.get("mapy"))
        if lng is None or lat is None:
            skipped += 1
            continue
        town, _ = nearest_town(lng, lat, towns)
        if town is None:
            skipped += 1
            continue
        zh = zh_map.get(cid) or ""
        en = en_map.get(cid) or ""
        zh = None if zh and re.fullmatch(r"[\s0-9A-Za-z]+", zh) else zh  # 中文服务没译时回落韩文
        h = to_hotel(it, zh or None, en or None, town.get("ko"))
        if not h:
            skipped += 1
            continue

        # 1) 同一 contentId 已导入过 → 原地更新
        old = by_cid.get(cid)
        if old is None:
            # 2) 坐标附近已有 OSM 条目 → 视为同一家，补字段不新增
            for e in existing:
                if dist_m(lng, lat, e.get("lng"), e.get("lat")) < DUP_M:
                    old = e
                    break
        if old is not None:
            for k in ("nameZh", "nameEn", "address", "phone"):
                if h.get(k) and not old.get(k):
                    old[k] = h[k]
            # note 每次都按校准后的 cat3 刷新：cat3 映射改过（或以前写错）时能自愈，
            # 随后 gen_stay_zh.py 还会用名称里的业态词再覆盖一次，cat3 只兜底。
            old["note"] = h["note"]
            # 只有真的拿到官方外语名才上「官方」标记；自动生成的中译仍可被后续重算刷新
            if zh:
                old["nameZhOfficial"] = True
            if en:
                old["nameEnOfficial"] = True
            old["source"] = "tourapi"
            old["contentId"] = cid
            merged += 1
            continue

        town.setdefault("hotels", []).append(h)
        added += 1

    d["towns"] = towns
    d["partial"] = False
    d.setdefault("sources", [])
    if "tourapi" not in d["sources"]:
        d["sources"].append("tourapi")
    json.dump(d, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"新增 {added} 家，合并进已有条目 {merged} 家，跳过（缺坐标/归不到城镇）{skipped} 家")
    print("落盘后请重跑前端构建（seedStays.ts 会自动从 src/data/stays.json 派生）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
