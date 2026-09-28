"""Wikimedia Commons 自由授权图片抓取：按偶来小路路线地点匹配照片。

用法：
  python3 fetch_photos.py --limit 1     # 只跑第一条，用于测速与验证
  python3 fetch_photos.py               # 全量
  python3 fetch_photos.py --dry         # 只搜索不下载，输出匹配结果

产出：
  public/photos/olle-<code>.jpg
  public/photos/credits.json   （作者 / 许可 / 来源页，用于生成 CREDITS.md）
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "Trail100k-OllePhotoFetcher/0.1 (personal local project)"
API = "https://commons.wikimedia.org/w/api.php"
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "photos")
WIDTH = 1600

# 每条路线：编号 -> 多级搜索关键词，逐个尝试直到命中
QUERIES = {
    "01": ["Seongsan Ilchulbong", "Gwangchigi beach Jeju", "Jeju east coast"],
    "01-1": ["Udo Island Jeju", "Udo Jeju"],
    "02": ["Onpyeong Jeju", "Gwangchigi Jeju", "Jeju east coast"],
    "03": ["Pyoseon Jeju", "Jeju southeast coast", "Jeju coast"],
    "04": ["Namwon Jeju", "Jeju south coast"],
    "05": ["Soesokkak", "Soesokkak Jeju"],
    "06": ["Seogwipo", "Seogwipo coast"],
    "07": ["Oedolgae Seogwipo", "Seogwipo coast", "Jeju Olle"],
    "07-1": ["Seogwipo", "Jeju Olle trail"],
    "08": ["Jungmun Jeju", "Daepyeong Jeju", "Jeju south coast"],
    "09": ["Sanbangsan", "Hwasun Jeju", "Jeju southwest coast"],
    "10": ["Songaksan", "Moseulpo Jeju", "Jeju southwest coast"],
    "10-1": ["Gapado", "Gapado island Jeju"],
    "11": ["Moseulpo", "Jeju southwest inland", "Jeju Gotjawal"],
    "12": ["Yongsu Jeju", "Jeju west coast"],
    "13": ["Jeoji Jeju", "Jeju west coast"],
    "14": ["Hyeopjae beach", "Hallim Jeju", "Jeju northwest coast"],
    "14-1": ["Seogwang Jeju", "Jeju west inland", "Jeju Gotjawal"],
    "15": ["Gonae Jeju", "Aewol Jeju", "Jeju north coast"],
    "16": ["Gwangnyeong Jeju", "Aewol coast Jeju", "Jeju north coast"],
    "17": ["Jeju City", "Jeju north coast"],
    "18": ["Jocheon Jeju", "Hamdeok beach", "Jeju northeast coast"],
    "18-1": ["Chuja Island", "Chujado Jeju"],
    "18-2": ["Chuja Island", "Chujado Jeju"],
    "19": ["Gimnyeong beach", "Gimnyeong Jeju", "Jeju northeast coast"],
    "20": ["Hado Jeju", "Seongsan Jeju", "Jeju east coast"],
    "21": ["Jongdal Jeju", "Jimi peak Jeju", "Jeju east coast"],
}

TAG_RE = re.compile(r"<[^>]+>")

# 路线编号 -> 中文地点名，写进 manifest 的说明文字
CODE_LABEL = {
    "01": "始兴 → 广峙其（城山日出峰一带）",
    "01-1": "牛岛",
    "02": "广峙其 → 温坪",
    "03": "温坪 → 表善",
    "04": "表善 → 南元",
    "05": "南元 → 牛沼河口",
    "06": "牛沼河口 → 偶来旅客中心",
    "07": "偶来旅客中心 → 西归浦巴士总站",
    "07-1": "西归浦巴士总站 → 偶来旅客中心",
    "08": "月坪 → 大坪（中文一带）",
    "09": "大坪 → 和顺（山房山一带）",
    "10": "和顺 → 摹瑟浦（松岳山一带）",
    "10-1": "加波岛",
    "11": "摹瑟浦 → 武陵",
    "12": "武陵 → 龙水",
    "13": "龙水 → 楮旨",
    "14": "楮旨 → 翰林（挟才海水浴场一带）",
    "14-1": "楮旨 → 西广",
    "15": "翰林 → 高内（涯月一带）",
    "16": "高内 → 广宁",
    "17": "广宁 → 金万德纪念馆（济州市）",
    "18": "金万德纪念馆 → 朝天（咸德一带）",
    "18-1": "上楮子岛",
    "18-2": "下楮子岛",
    "19": "朝天 → 金宁",
    "20": "金宁 → 下道",
    "21": "下道 → 终达",
}


def strip_html(s: str) -> str:
    s = TAG_RE.sub("", s or "")
    return " ".join(s.split()).strip()


def search(keyword: str):
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": f"filetype:bitmap {keyword}",
        "gsrnamespace": "6",
        "gsrlimit": "6",
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|size",
        "iiurlwidth": str(WIDTH),
    }
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        data = json.load(r)
    pages = (data.get("query") or {}).get("pages") or {}
    out = []
    for p in pages.values():
        ii = (p.get("imageinfo") or [None])[0]
        if not ii:
            continue
        meta = ii.get("extmetadata") or {}
        out.append(
            {
                "title": p.get("title", ""),
                "thumb": ii.get("thumburl"),
                "descpage": ii.get("descriptionurl"),
                "artist": strip_html((meta.get("Artist") or {}).get("value", "")),
                "license": strip_html((meta.get("LicenseShortName") or {}).get("value", "")),
            }
        )
    # 标题里带 Jeju / Olle 的优先
    out.sort(key=lambda x: 0 if "jeju" in x["title"].lower() or "olle" in x["title"].lower() else 1)
    return out


def download(url: str, path: str) -> bool:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as r:
        data = r.read()
    if len(data) < 5000:
        return False
    with open(path, "wb") as f:
        f.write(data)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    codes = list(QUERIES.keys())
    if args.limit:
        codes = codes[: args.limit]

    credits = {}
    for code in codes:
        t0 = time.time()
        picked = None
        used_kw = None
        for kw in QUERIES[code]:
            try:
                results = search(kw)
            except Exception as e:
                print(f"[{code}] search fail '{kw}': {e}", file=sys.stderr)
                continue
            if results:
                picked = results[0]
                used_kw = kw
                break
        if not picked:
            print(f"[{code}] NO RESULT ({time.time()-t0:.1f}s)")
            continue

        fname = f"olle-{code.replace('-', '_')}.jpg"
        path = os.path.join(OUT_DIR, fname)
        ok = True
        if not args.dry:
            try:
                ok = download(picked["thumb"], path)
            except Exception as e:
                print(f"[{code}] download fail: {e}", file=sys.stderr)
                ok = False
        if ok:
            credits[code] = {
                "file": fname,
                "title": picked["title"],
                "keyword": used_kw,
                "artist": picked["artist"],
                "license": picked["license"],
                "source": picked["descpage"],
            }
            size = os.path.getsize(path) if os.path.exists(path) else 0
            print(f"[{code}] {fname} {size//1024}KB | {picked['license']} | {picked['title'][:60]} ({time.time()-t0:.1f}s)")
        else:
            print(f"[{code}] FAILED")

    # manifest.json：前端按路线编号自动绑定照片（不写进 localStorage，运行时叠加）
    manifest = {}
    for code, c in credits.items():
        zh = CODE_LABEL.get(code, "")
        manifest[code] = {
            "file": f"photos/{c['file']}",
            "caption": f"{zh}（Wikimedia Commons 自由授权，非官方实测照片）",
            "credit": " / ".join(x for x in [c["artist"], c["license"]] if x),
            "source": c["source"],
        }
    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # CREDITS.md：署名清单，随项目一起分发，满足 CC-BY 的署名要求
    lines = [
        "# 图片素材署名（Credits）",
        "",
        "本站 27 条偶来小路的配图来自 Wikimedia Commons，均为 CC0 / CC-BY / 公共领域等自由授权作品。",
        "照片为「该路线所在地点」的示意照片，**不是官方路线的官方摄影**，仅用于界面展示。",
        "",
        "| 路线 | 文件 | 作者 | 许可 | 来源页 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for code in sorted(credits, key=lambda x: (len(x), x)):
        c = credits[code]
        lines.append(f"| {code} | {c['file']} | {c['artist'] or '—'} | {c['license'] or '—'} | {c['source'] or '—'} |")
    lines += [
        "",
        "如需移除某张图，删除 `public/photos/` 下对应文件与 `manifest.json` 中的条目即可，站点会自动回退到「无图」占位。",
        "",
        "数据源：https://commons.wikimedia.org（本脚本通过官方 MediaWiki API 检索，仅下载自由授权作品）",
        "",
    ]
    with open(os.path.join(OUT_DIR, "CREDITS.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"\ndone: {len(credits)}/{len(codes)} -> {OUT_DIR}")


if __name__ == "__main__":
    main()
