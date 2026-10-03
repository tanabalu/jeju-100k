#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为「人工补充看点」抓取 Wikimedia Commons 自由授权封面图，并写回数据管线。

复用 fetch_photos.py 的检索 / 自由许可过滤 / WebP 压缩原语（不重写），只把目标从
「按路线编号」换成「按看点 id」，并回写 curated_sights.json 的 images 字段。

合规：只取 CC0 / CC-BY / CC-BY-SA / 公共领域作品（fetch_photos 的 FREE_RE / JEJU_RE /
JUNK_RE 已把关），署名写进独立的 public/photos/CREDITS_SIGHTS.md（不放 CREDITS.md，
因为 CREDITS.md 由 fetch_photos.py 每次整体重写，会冲掉看点署名）。

产出：
  public/photos/sights/<sight-id>.webp   每张看点一张封面（默认 1280px, q80）
  scripts/data/curated_sights.json       回写该看点的 images: ImageRef[]
  src/lib/sightsData.ts                  重新生成（含 images）
  public/photos/CREDITS_SIGHTS.md        看点封面署名段（CC-BY 要求）

用法：
  python3 fetch_sight_photos.py                 # 全量 8 处看点
  python3 fetch_sight_photos.py --ids cur-01-1  # 只抓某一处（逗号分隔可多个）
  python3 fetch_sight_photos.py --dry           # 只搜索、打印会选哪张，不下载
  python3 fetch_sight_photos.py --force         # 已抓过的也重新下载
  python3 fetch_sight_photos.py --proxy http://127.0.0.1:7890   # 走本机代理
  python3 fetch_sight_photos.py --url           # 不下载，直接把 Commons 缩略图 URL
                                                #   写进 images（运行时由浏览器直连 Wikimedia）

⚠️ 网络：commons.wikimedia.org / upload.wikimedia.org 在部分网络（含大陆家用宽带、部分沙箱）
   不可达，脚本会超时报错。此时用 --proxy 指向本机代理，或在能访问的环境里执行。
   （App 运行在用户浏览器里，浏览器端通常能直连 Wikimedia；--url 模式即利用这一点，
   不必在本机下载。）
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_photos as fp  # 复用检索/许可过滤/WebP 压缩原语

ROOT = fp.ROOT
SIGHTS_JSON = os.path.join(ROOT, "scripts", "data", "curated_sights.json")
SIGHTS_OUT_DIR = os.path.join(ROOT, "public", "photos", "sights")
CREDITS_SIGHTS = os.path.join(ROOT, "public", "photos", "CREDITS_SIGHTS.md")
WIDTH = 1280
QUALITY = 80

# 看点 id -> 多级检索词（具体地标 -> 韩文名 -> Jeju 兜底）。
# 策略与 fetch_photos.QUERIES 一致：具体地标命中权重最高，泛词只兜底。
SIGHT_QUERIES: dict[str, list[str]] = {
    "cur-01-1": ["Seopjikoji", "세복지코지 제주", "Seopjikoji Jeju"],
    "cur-06-1": ["Jeongbang Falls", "정방폭포 제주", "Jeongbangpokpo Jeju"],
    "cur-07-1": ["Cheonjiyeon Falls", "천지연폭포 제주", "Cheonjiyeon Jeju"],
    "cur-08-1": ["Daepo Jusangjeolli", "주상절리 제주", "Jusangjeolli Jeju"],
    "cur-14-1": ["Hallim Park Jeju", "한림공원 제주", "Hallim Jeju"],
    "cur-14-2": ["Biyangdo", "비양도 제주", "Biyang-do Jeju"],
    "cur-15-A-1": ["Hyeopjae Beach", "협재해수욕장 제주", "Hyeopjae Jeju"],
    "cur-20-1": ["Manjanggul", "만장굴 제주", "Manjanggul Cave Jeju"],
}

# 看点 id -> 本地已有 CC 图所在的路线键（public/photos/manifest.json 的 key）。
# 这些图是上次已从 Commons 抓好、随仓库分发的路线配图，--local 模式直接复用，无需联网。
# 只登记「确认就是该景点本身」的精确匹配；宁可留空，也不用邻近景点的照片顶替。
SIGHT_LOCAL: dict[str, str] = {
    "cur-08-1": "08",   # 柱状节理带：olle-08 主图即 Jungmun Daepo Jusangjeolli Cliff
    "cur-15-A-1": "14",   # 挟才海滩：olle-14 主图即 Hyeopjae Beach
    "cur-19-1": "18",   # 咸德海水浴场：olle-18 主图即 Hamdeok Beach（图在 18 号线路段上，景点属 19 号线）
}

# 看点 id -> 中文名（用于署名表与 CREDITS 可读性）
SIGHT_LABEL: dict[str, str] = {
    "cur-01-1": "涉地可支",
    "cur-06-1": "正房瀑布",
    "cur-07-1": "天地渊瀑布",
    "cur-08-1": "柱状节理带",
    "cur-14-1": "翰林公园",
    "cur-14-2": "飞扬岛",
    "cur-15-A-1": "挟才海滩",
    "cur-20-1": "万丈窟",
}


def sight_id(code: str, idx: int) -> str:
    """复刻 build_sights_data.py 的 id 规则：cur-{code}-{序号（从 1 开始）}。

    curated_sights.json 的条目本身不带 id —— id 是生成 sightsData.ts 时按位置拼出来的，
    所以这里必须按同一规则复算，才能和 DEFAULT_SIGHTS 里的 Sight.id 对上。
    """
    return f"cur-{code}-{idx}"


def flat_sights() -> list[tuple[str, int, str, dict]]:
    """把 curated_sights.json 拍平成 (code, idx, sid, item)。sid 由位置复算得出。"""
    data = json.loads(open(SIGHTS_JSON, encoding="utf-8").read())
    out = []
    for code, items in data["sights"].items():
        for i, s in enumerate(items, 1):
            out.append((code, i, sight_id(code, i), s))
    return out


def local_result(sid: str, manifest: dict) -> dict | None:
    """--local：从 public/photos/manifest.json 复用已随仓库分发的 CC 图，不联网。

    只认 SIGHT_LOCAL 里显式登记的精确匹配；没登记或文件缺失则返回 None（宁可留空，
    也不用邻近景点的照片顶替，避免张冠李戴）。
    """
    route = SIGHT_LOCAL.get(sid)
    if not route or route not in manifest:
        return None
    v = manifest[route]
    rel = v.get("file", "")
    full = os.path.join(ROOT, "public", rel)
    if not rel or not os.path.exists(full):
        return None
    dims = webp_size(full) or (0, 0)
    artist, _, license_ = (v.get("credit", "") or "").partition(" / ")
    return {
        "file": rel,
        "w": dims[0],
        "h": dims[1],
        "title": v.get("title", ""),
        "artist": artist.strip(),
        "license": license_.strip(),
        "descpage": v.get("source", ""),
    }


def webp_size(path: str) -> tuple[int, int] | None:
    """读已存在 webp 的宽高（补齐 width/height）。Pillow 缺失或读不出时静默返回 None。"""
    try:
        from PIL import Image

        with Image.open(path) as im:
            return im.size
    except Exception:
        return None


def pick(opener, sight_id: str, sleep: float, used: set) -> tuple[dict | None, str | None]:
    for kw in SIGHT_QUERIES.get(sight_id, []):
        try:
            results = fp.search(opener, kw, WIDTH, code=None, used=used, sleep=sleep)
        except Exception as e:  # 单关键词失败不致命，换下一个词
            print(f"    search fail '{kw}': {e}", file=sys.stderr)
            continue
        if results:
            return results[0], kw
    return None, None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="", help="只抓这些看点 id，逗号分隔，如 cur-01-1,cur-15-1")
    ap.add_argument("--dry", action="store_true", help="只搜索不下载")
    ap.add_argument("--force", action="store_true", help="已存在的图也重新下载")
    ap.add_argument("--proxy", default="", help="如 http://127.0.0.1:7890，本机代理")
    ap.add_argument("--url", action="store_true",
                    help="不下载，直接把 Commons 缩略图 URL 写进 images（浏览器运行时直连）")
    ap.add_argument("--local", action="store_true",
                    help="完全不联网：直接复用 public/photos 里已有的 CC 图（仅精确匹配的看点，"
                         "见 SIGHT_LOCAL；没匹配的跳过）")
    ap.add_argument("--sleep", type=float, default=2.0, help="API 请求间隔秒数")
    ap.add_argument("--no-cache", action="store_true", help="不复用 scripts/.cache 里的检索结果")
    args = ap.parse_args()

    if not args.no_cache:
        fp.load_cache()
    fp._cache_on = not args.no_cache

    opener = fp.build_opener(args.proxy or None)
    os.makedirs(SIGHTS_OUT_DIR, exist_ok=True)

    all_sights = flat_sights()
    if args.ids:
        want = {x.strip() for x in args.ids.split(",") if x.strip()}
        targets = [t for t in all_sights if t[2] in want]
        unknown = want - {t[2] for t in all_sights}
        if unknown:
            print(f"警告：未知看点 id {', '.join(sorted(unknown))}"
                  f"（可用：{', '.join(t[2] for t in all_sights)}）", file=sys.stderr)
    else:
        if args.local:
            key_map: dict[str, object] = SIGHT_LOCAL
            miss_hint = f"没有本地可复用图，已跳过（请在 SIGHT_LOCAL 登记）："
        else:
            key_map = SIGHT_QUERIES
            miss_hint = f"还没配检索词，已跳过（请在 SIGHT_QUERIES 补）："
        # 只处理登记过的看点；没登记的显式提示，避免静默跳过。
        targets = [t for t in all_sights if t[2] in key_map]
        no_query = [t[2] for t in all_sights if t[2] not in key_map]
        if no_query:
            print(f"提示：以下看点{miss_hint}{', '.join(no_query)}", file=sys.stderr)

    manifest: dict = {}
    if args.local:
        mp = os.path.join(ROOT, "public", "photos", "manifest.json")
        manifest = json.loads(open(mp, encoding="utf-8").read()) if os.path.exists(mp) else {}

    # 读入 curated_sights.json（原地回写 images）
    data = json.loads(open(SIGHTS_JSON, encoding="utf-8").read())

    used_titles: set[str] = set()
    credits: list[dict] = []
    n_done = 0
    failed: list[str] = []

    for code, idx, sid, s in targets:
        t0 = time.time()
        if args.local:
            result = local_result(sid, manifest)
            kw = "(local)"
            if not result:
                failed.append(sid)
                print(f"[{sid}] 本地无可复用的精确匹配图，跳过")
                continue
        else:
            result, kw = pick(opener, sid, args.sleep, used_titles)
            if not result:
                failed.append(sid)
                print(f"[{sid}] 无可用结果（{time.time()-t0:.1f}s）")
                continue

        if args.dry:
            print(f"[{sid}] 会选：{result['title'][:70]} | {result['license']} | kw={kw}")
            continue

        if args.local:
            ref = {
                "kind": "url",
                "value": result["file"],
                "width": result["w"],
                "height": result["h"],
            }
        elif args.url:
            ref = {
                "kind": "url",
                "value": result["thumb"],
                "width": result["w"],
                "height": result["h"],
            }
        else:
            dest = os.path.join(SIGHTS_OUT_DIR, f"{sid}.webp")
            rel = f"photos/sights/{sid}.webp"
            if os.path.exists(dest) and not args.force:
                print(f"[{sid}] 已有 {sid}.webp（--force 可重抓）")
                # 仍确保 curated_sights.json 里记录了 images（可能上次只下了图没写回）
                ref = {"kind": "url", "value": rel}
                dims = webp_size(dest)
                if dims:
                    ref["width"], ref["height"] = dims
            else:
                try:
                    _, _, size = fp.save_image(
                        opener, result, dest, None, WIDTH, QUALITY, 0, 0
                    )
                except Exception as e:
                    failed.append(sid)
                    print(f"[{sid}] 下载失败：{e}", file=sys.stderr)
                    continue
                ref = {
                    "kind": "url",
                    "value": rel,
                    "width": size[0],
                    "height": size[1],
                }
                print(f"[{sid}] {sid}.webp {size[0]}x{size[1]} | {result['license']} "
                      f"({time.time()-t0:.1f}s)")
            # 纳入去重，避免别处再选同一张
            used_titles.add(result["title"])

        # 回写 curated_sights.json 的这条看点 images
        data["sights"][code][idx - 1]["images"] = [ref]
        credits.append({
            "id": sid,
            # 缺省回落到数据里的真实名称，避免 SIGHT_LABEL 漏登记时署名表只剩一个 id
            "label": SIGHT_LABEL.get(sid) or s.get("name") or sid,
            "title": result["title"],
            "artist": result["artist"],
            "license": result["license"],
            "source": result["descpage"],
            "url": ref["value"],
        })
        n_done += 1

    if args.dry:
        print("\n--dry：未下载、未改数据")
        fp.save_cache()
        return 0

    # 落盘 curated_sights.json
    json.dump(data, open(SIGHTS_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    # 重新生成 src/lib/sightsData.ts（透传 images）
    try:
        import build_sights_data
        try:
            build_sights_data.main()
        except SystemExit:
            pass
    except Exception as e:
        print(f"重新生成 sightsData.ts 失败：{e}", file=sys.stderr)

    # 看点署名（独立文件，避免被 fetch_photos.py 重写的 CREDITS.md 冲掉）
    if credits:
        lines = [
            "# 看点封面署名（Sight Covers Credits）",
            "",
            "「人工补充看点」的封面图来自 Wikimedia Commons，均为 CC0 / CC-BY / CC-BY-SA / 公共领域等自由授权作品。",
            "",
            "⚠️ 这些是「该景点」的风景照，**不是官方路线摄影**，仅用于界面展示。",
            "",
            "| 看点 | 文件/链接 | 作者 | 许可 | 来源页 |",
            "| --- | --- | --- | --- | --- |",
        ]
        for c in credits:
            lines.append(
                f"| {c['label']} ({c['id']}) | {c['url']} | {c['artist'] or '—'} | {c['license'] or '—'} | {c['source'] or '—'} |"
            )
        lines.append("")
        lines.append("数据源：https://commons.wikimedia.org（通过官方 MediaWiki API 检索，仅取自由授权作品）")
        lines.append("")
        with open(CREDITS_SIGHTS, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

    fp.save_cache()
    print(f"\ndone: 处理 {len(targets)} 处看点，成功 {n_done} 处；"
          f"已回写 curated_sights.json / sightsData.ts" + (f"，未取到：{', '.join(failed)}" if failed else ""))
    if failed:
        print("未取到的可重跑本脚本补（或换 --proxy / --url）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
