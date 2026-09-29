"""Wikimedia Commons 自由授权图片抓取：按偶来小路路线地点匹配照片，出「卡片封面 + 详情页原图」两份。

用法：
  python3 fetch_photos.py --limit 1          # 只跑第一条，用于测速与验证
  python3 fetch_photos.py                    # 全量（27 条）
  python3 fetch_photos.py --dry              # 只搜索不下载，输出会选中哪张
  python3 fetch_photos.py --codes 01,07,18-2 # 只补几条
  python3 fetch_photos.py --proxy http://127.0.0.1:7890   # 走本机代理（Wikimedia 需要）
  python3 fetch_photos.py --force            # 已存在的图也重新下载
  python3 fetch_photos.py --sleep 3          # 被 429 限流时把请求间隔调大

产出：
  public/photos/scenes/olle-<code>.webp         详情页原图：1600px 宽，q82，约 120KB
  public/photos/scenes/cover/olle-<code>.webp   卡片封面：760px 宽，q74，约 25KB
  public/photos/manifest.json                   { file, cover, caption, credit, source }，前端按编号自动绑定
  public/photos/CREDITS.md                      署名清单（CC-BY 要求）

为什么出两份：卡片在列表里只渲染到 300–400px 宽，给原图纯属浪费；详情页相册/灯箱才需要大图。
压缩在本地做（Pillow 降尺寸 + WebP 降质），不需要 API key、不上传第三方、可复现。

⚠️ 网络：commons.wikimedia.org / upload.wikimedia.org 在部分网络环境（含大陆家用宽带）不可达，
   脚本会直接超时报错。此时用 `--proxy` 指向本机代理，或在能访问的环境里执行；
   也可以先 `curl -s -o /dev/null -w '%{http_code}' https://commons.wikimedia.org/w/api.php` 探一下。
"""

import argparse
import glob
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

try:
    from PIL import Image
except ImportError:
    sys.exit("缺少依赖：pip install Pillow")

try:
    RESAMPLE = Image.Resampling.LANCZOS
except AttributeError:  # pragma: no cover - 兼容旧 Pillow
    RESAMPLE = Image.LANCZOS

# Wikimedia 要求 UA 带联系方式，且对频率敏感：不带联系信息的匿名 UA 更容易被 429
UA = "Trail100k-OllePhotoFetcher/0.3 (personal non-commercial project; contact: github.com/tanabalu/jeju-100k)"
API = "https://commons.wikimedia.org/w/api.php"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "photos", "scenes")
COVER_DIR = os.path.join(OUT_DIR, "cover")
MANIFEST = os.path.join(ROOT, "public", "photos", "manifest.json")
CREDITS = os.path.join(ROOT, "public", "photos", "CREDITS.md")

# 每条路线：编号 -> 多级搜索关键词，逐个尝试直到命中。
# 2026-09-29 实跑修正：早先那版太泛，抓回来一堆「不是这条线」的图 ——
# 12/13/21 全都选中同一张近方形的 Bavi、06/07-1 选中度假村广告图、19 选中 Route 20 的照片。
# 现在每条都补上**具体地标 + 韩文名**（Commons 上韩国地名多是韩文标题），泛词只留最后一个兜底。
# 第二轮回改：兜底词 "Jeju west coast" 这类太泛，搜回来的是「加那利群岛云图 / LNG 码头 / 日本航拍」，
# 所以兜底也一律换成**带济州地名的词**，实在没有才用 "Jeju Olle trail"。
QUERIES = {
    "01": ["Seongsan Ilchulbong", "성산일출봉", "Gwangchigi beach Jeju", "Jeju Olle trail"],
    "01-1": ["Udo Island Jeju", "우도 제주", "Udo-do Jeju", "Udo lighthouse Jeju"],
    "02": ["Onpyeong port Jeju", "온평 제주", "Gwangchigi beach Jeju", "Samdal-ri Jeju"],
    "03": ["Pyoseon beach Jeju", "표선 제주", "Pyoseon-myeon Jeju", "Jeju Olle trail"],
    "04": ["Namwon-eup Jeju", "남원읍 제주", "Wimi-ri Jeju", "Namwon harbor Jeju"],
    "05": ["Soesokkak", "쇠소깍", "Soesokkak Jeju", "Jeju Olle trail"],
    "06": ["Chilsimni Seogwipo", "정방폭포 제주", "Seogwipo harbor", "서귀포항 제주"],
    "07": ["Oedolgae", "외돌개 제주", "Oedolgae rock Jeju", "서귀포 제주"],
    "07-1": ["Saeyeongyo bridge Seogwipo", "서귀포 올레", "Seogwipo Olle trail", "Jeju Olle trail"],
    "08": ["Jungmun Jeju", "주상절리 제주", "Daepyeong Jeju", "중문 제주"],
    "09": ["Sanbangsan", "산방산", "Hwasun Jeju", "화순 제주"],
    "10": ["Songaksan", "송악산", "Moseulpo Jeju", "Jeju Olle trail"],
    "10-1": ["Gapado", "가파도", "Gapado island Jeju", "Jeju Olle trail"],
    "11": ["Moseulpo", "모슬포", "Moseulpo harbor Jeju", "Jeju Gotjawal"],
    "12": ["Yongsu-ri Jeju", "용수리 제주", "Suwolbong Jeju", "Jeju Olle trail"],
    "13": ["Jeoji-ri Jeju", "저지리 제주", "Jeoji Gotjawal Jeju", "Cheongsu-ri Jeju", "Jeju Olle trail"],
    "14": ["Hyeopjae beach", "협재해수욕장", "Hallim Jeju", "한림 제주"],
    "14-1": ["Seogwang-ri Jeju", "서광리 제주", "Jeju west inland", "Jeju Gotjawal"],
    "15": ["Gonae-ri Jeju", "고내리 제주", "Gwakji beach Jeju", "애월 제주", "Jeju Olle trail"],
    "16": ["Gwangnyeong-ri Jeju", "광령리 제주", "Handam beach Jeju", "애월 해안도로 제주", "Jeju Olle trail"],
    "17": ["Yongduam rock Jeju", "용두암 제주", "Dodu-dong Jeju", "Jeju Olle trail"],
    "18": ["Hamdeok beach", "함덕해수욕장", "Jocheon Jeju", "조천 제주"],
    "18-1": ["Chujado", "상추자도", "Chuja Island Jeju", "Chujado harbor"],
    "18-2": ["Hachuja island", "하추자도", "Chujado Jeju", "Chuja Island"],
    "19": ["Gimnyeong beach Jeju", "김녕성세기해변", "Gimnyeong maze Jeju", "Woljeong-ri Jeju", "Jeju Olle trail"],
    "20": ["Hado-ri Jeju", "하도 제주", "Sehwa Jeju", "Jeju Olle trail"],
    "21": ["Jongdal-ri Jeju", "종달리 제주", "Jongdal port Jeju", "지미봉 제주", "Jeju Olle trail"],
}


def queries_for(code: str) -> list[str]:
    """该路线的检索词顺序：具体地标 → 韩文地名 → 官方路线照 → 泛兜底。

    末两位是 Commons 上「Jeju Olle Route NN.jpg」这类官方路线照的通配写法，
    地标词全落空时它比纯泛词准得多：16 / 18-1 / 18-2 就是靠「路线号 + 官方照」命中的。
    """
    base = list(QUERIES.get(code, []))
    # 「Jeju Olle trail」是纯泛词（曾搜回加那利群岛云图），必须排在路线号照之后，
    # 否则 13 这类地标词全落空的条线会先吃下泛词结果，拿不到自己的官方路线照。
    generic = "Jeju Olle trail"
    had_generic = generic in base
    if had_generic:
        base.remove(generic)
    for extra in (f"Jeju Olle Route {code}", f"올레 {code}코스"):
        if extra not in base:
            base.append(extra)
    if had_generic:
        base.append(generic)
    return base


# 路线编号 -> 中文地点名（split_route_map.py 也复用这份，避免两处漂移）
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

TAG_RE = re.compile(r"<[^>]+>")
# 地图/标识/图表不是风景照，不能当封面
# 注意 \bsign\b 匹配不到 "signage"（后面还有字母，没有词边界）——16 线就漏进来过
# 「Ganse signage jejuolle-route-16.jpg」这种标识牌特写，不是风景。
JUNK_RE = re.compile(
    r"\b(map|maps|logo|sign|signs|signage|signboard|diagram|chart|panorama|collage"
    r"|poster|flag|coat of arms|ganse)\b|안내판|표지판|간세",
    re.I,
)
# 只接受明确自由许可；拿不到许可字段的一律不要
FREE_RE = re.compile(r"(cc0|public domain|pd-|cc by|cc-by|cc_by)", re.I)
BAD_RE = re.compile(r"(fair use|non-free|nonfree|all rights reserved|© all)", re.I)
# 标题里写了别条路线的编号（如给 16 线选到 "Jejuolle-route-18(1)"）→ 说明匹配错了。
# 分隔符必须含 `-` `_`：route-18 / route_18 都是 Commons 常见写法，只写 \s* 会整条漏判。
ROUTE_NUM_RE = re.compile(r"(?:route|olle(?:gil)?|course|trail)[\s\-_]*0*(\d+)|(\d+)\s*코스", re.I)
# 图片必须真跟济州有关。Commons 全文检索是模糊的：搜 "Jeju west coast" 会返回
# 「加那利群岛涡旋云」「LNG 码头」「View of Japan」这类八竿子打不着的图，
# 所以要求标题或描述里出现济州/偶来的任一写法，否则丢弃。
JEJU_RE = re.compile(r"jeju|cheju|제주|olle|올레", re.I)

# 近方形的图当卡片封面会被裁得几乎没内容（实测 6218×6012 那张被 12/13/21 同时选中）
ASPECT_MIN = 1.25

CACHE_PATH = os.path.join(ROOT, "scripts", ".cache", "photos_search.json")
# 同一批关键词在 --dry 与正式跑之间要打两次，缓存掉省一半请求、也少撞一次限流
_cache: dict = {}
_cache_on = False


def load_cache():
    global _cache
    if not os.path.exists(CACHE_PATH):
        return
    try:
        with open(CACHE_PATH, encoding="utf-8") as f:
            _cache = json.load(f)
    except Exception:
        _cache = {}


def save_cache():
    if not _cache_on:
        return
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(_cache, f, ensure_ascii=False)


_last_call = [0.0]


def pace(seconds: float):
    """请求之间留间隔。Wikimedia 对匿名高频请求会直接 429（实测跑到第 15 条就限流）"""
    gap = seconds - (time.time() - _last_call[0])
    if gap > 0:
        time.sleep(gap)
    _last_call[0] = time.time()


def route_num_ok(title: str, code: str) -> bool:
    """标题里若出现了路线号，就必须和本条对得上；没出现就不约束"""
    nums = {int(a or b) for a, b in ROUTE_NUM_RE.findall(title)}
    if not nums:
        return True
    base = int(re.match(r"\d+", code).group())  # 07-1 → 7、18-2 → 18
    return base in nums


def strip_html(s: str) -> str:
    return " ".join(TAG_RE.sub("", s or "").split()).strip()


def build_opener(proxy):
    """显式代理优先；不传就用系统环境（urllib 默认读 http_proxy/https_proxy）"""
    if not proxy:
        return urllib.request.build_opener()
    return urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))


def get_json(opener, params: dict, tries: int = 3):
    url = API + "?" + urllib.parse.urlencode(params)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with opener.open(req, timeout=25) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            last = e
            # 429/503 是限流，退避等待后重试；4xx 里的其它错误（如参数错）重试没意义
            if e.code in (429, 503):
                wait = 5 * (i + 1)
                print(f"    限流 {e.code}，等 {wait}s 后重试（第 {i+1}/{tries} 次）", file=sys.stderr)
                time.sleep(wait)
                continue
            raise
        except Exception as e:
            last = e
            if i == 0:
                time.sleep(1.5)
    raise last


def search(opener, keyword: str, width: int, code=None, used=None, sleep: float = 1.5):
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": f"filetype:bitmap {keyword}",
        "gsrnamespace": "6",
        "gsrlimit": "8",
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|size",
        "iiurlwidth": str(width),
    }
    key = f"{keyword}|{width}"
    data = _cache.get(key)
    if data is None:
        pace(sleep)
        data = get_json(opener, params)
        _cache[key] = data
        save_cache()
    pages = (data.get("query") or {}).get("pages") or {}
    out = []
    for p in pages.values():
        ii = (p.get("imageinfo") or [None])[0]
        if not ii:
            continue
        title = p.get("title", "")
        meta = ii.get("extmetadata") or {}
        license_name = strip_html((meta.get("LicenseShortName") or {}).get("value", ""))
        # 标题不一定写 Jeju（"Sanbangsan (2025-01).jpg" 就没写），描述里通常有
        desc = strip_html((meta.get("ImageDescription") or {}).get("value", ""))
        w, h = ii.get("width") or 0, ii.get("height") or 0
        if not JEJU_RE.search(f"{title} {desc}"):
            continue  # 跟济州无关 → 搜歪了
        if not license_name or BAD_RE.search(license_name) or not FREE_RE.search(license_name):
            continue  # 许可不明或非自由 → 直接不要，宁可这条线没封面
        if JUNK_RE.search(title):
            continue
        if w < 1200 or w / max(h, 1) < ASPECT_MIN:
            continue  # 要明显横构图，近方形/竖图当封面会被裁得看不出是什么
        if code and not route_num_ok(title, code):
            continue  # 标题写着别条路线的编号 → 匹配错了
        out.append(
            {
                "title": title,
                "thumb": ii.get("thumburl"),
                "descpage": ii.get("descriptionurl"),
                "artist": strip_html((meta.get("Artist") or {}).get("value", "")),
                "license": license_name,
                "w": w,
                "h": h,
            }
        )
    kw = keyword.lower()
    # 标题里带关键词 / Jeju / Olle 的优先：搜出来的第一张常常是无关配图
    def score(x):
        """关键词命中（具体地标）权重最高，泛泛的「Jeju」只做次级信号。
        搜 "Hyeopjae beach" 时，标题里有 Hyeopjae 的比只写 Jeju 的更像这条线。"""
        t = x["title"].lower()
        s = 0
        if "jeju" in t or "olle" in t:
            s -= 1
        for token in kw.split():
            if len(token) > 3 and token in t:
                s -= 3
        return s

    out.sort(key=score)

    # 去重：同一张图只服务一条路线（否则「Bavi」「olle-trail-ribbons」那类泛图会被好几条线同时选中）。
    # 全部候选都被用过时**返回空**而不是退回已用列表 —— 宁可这条线没照片（卡片回落到官方路线图），
    # 也不要列表里出现两张一模一样的封面。
    if used:
        return [x for x in out if x["title"] not in used]
    return out


def download(opener, url: str, tries: int = 2) -> bytes:
    last = None
    for i in range(tries):
        try:
            pace(0.5)  # upload.wikimedia.org 同样限流，别一口气连着下
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with opener.open(req, timeout=45) as r:
                data = r.read()
            if len(data) < 5000:
                raise ValueError(f"响应过小 {len(data)}B，疑似错误页")
            return data
        except Exception as e:
            last = e
            if i == 0:
                time.sleep(1.5)
    raise last


def encode_webp(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def prune(out_dir: str, keep: set) -> list:
    """清掉上一次跑剩下的陈图（只动本脚本产出的 olle-*.webp）"""
    removed = []
    for path in glob.glob(os.path.join(out_dir, "olle-*.webp")):
        if os.path.basename(path) not in keep:
            os.remove(path)
            removed.append(os.path.basename(path))
    return removed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--codes", default="", help="只跑这些编号，逗号分隔，如 01,07,18-2")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--force", action="store_true", help="已存在的图也重新下载")
    ap.add_argument("--proxy", default="", help="如 http://127.0.0.1:7890，本机代理")
    ap.add_argument("--width", type=int, default=1600, help="原图宽度")
    ap.add_argument("--quality", type=int, default=82, help="原图 WebP 质量")
    ap.add_argument("--cover-width", type=int, default=760, help="封面宽度，0 = 不单独出封面")
    ap.add_argument("--cover-quality", type=int, default=74, help="封面 WebP 质量")
    ap.add_argument("--no-prune", action="store_true")
    ap.add_argument("--sleep", type=float, default=2.0, help="API 请求间隔秒数，被限流就调大")
    ap.add_argument("--no-cache", action="store_true", help="不复用 scripts/.cache 里的检索结果")
    args = ap.parse_args()

    global _cache_on
    _cache_on = not args.no_cache
    if _cache_on:
        load_cache()

    opener = build_opener(args.proxy or None)
    os.makedirs(OUT_DIR, exist_ok=True)
    if args.cover_width:
        os.makedirs(COVER_DIR, exist_ok=True)

    codes = [c.strip() for c in args.codes.split(",") if c.strip()] if args.codes else list(QUERIES.keys())
    if args.limit:
        codes = codes[: args.limit]

    credits = {}
    manifest = {}
    # 先读旧 manifest：本次没抓到的条线保留上一轮结果，不会因为网络抖动整片丢封面
    if os.path.exists(MANIFEST):
        try:
            with open(MANIFEST, encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception:
            manifest = {}

    full_total = cover_total = 0
    failed = []
    used_titles = set()  # 已选中的图，避免多条线共用一张
    t_start = time.time()

    for code in codes:
        name = f"olle-{code.replace('-', '_')}.webp"
        dest = os.path.join(OUT_DIR, name)
        if os.path.exists(dest) and not args.force and not args.dry:
            # 断点跳过时也要把它占的图记进去重集合，否则分批跑（--codes）
            # 时后面那批会重新抢走这张图，出现两张一样的封面
            prev_title = manifest.get(code, {}).get("title")
            if prev_title:
                used_titles.add(prev_title)
            print(f"[{code:>5}] 已存在，跳过（--force 可重下）")
            continue

        t0 = time.time()
        picked = None
        used_kw = None
        for kw in queries_for(code):
            try:
                results = search(opener, kw, args.width, code=code, used=used_titles, sleep=args.sleep)
            except Exception as e:
                print(f"[{code}] search fail '{kw}': {e}", file=sys.stderr)
                continue
            if results:
                picked = results[0]
                used_kw = kw
                used_titles.add(picked["title"])
                break
        if not picked:
            failed.append(code)
            print(f"[{code:>5}] 无可用结果（{time.time()-t0:.1f}s）")
            continue

        if args.dry:
            print(f"[{code:>5}] 会选：{picked['title'][:70]} | {picked['license']} | {picked['w']}x{picked['h']} | kw={used_kw}")
            continue

        try:
            raw = download(opener, picked["thumb"])
        except Exception as e:
            failed.append(code)
            print(f"[{code:>5}] 下载失败：{e}", file=sys.stderr)
            continue

        try:
            img = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception as e:
            failed.append(code)
            print(f"[{code:>5}] 解码失败：{e}", file=sys.stderr)
            continue

        if img.size[0] > args.width:
            ratio = args.width / img.size[0]
            img = img.resize((args.width, max(1, round(img.size[1] * ratio))), RESAMPLE)

        data = encode_webp(img, args.quality)
        with open(dest, "wb") as f:
            f.write(data)
        full_total += len(data)

        entry = {
            "file": f"photos/scenes/{name}",
            "title": picked["title"],  # 断点续跑时靠它把已下载的图也纳入去重
            "caption": f"偶来 {code} {CODE_LABEL.get(code, '')} 一带风景（Wikimedia Commons 自由授权，非官方摄影）",
            "credit": " / ".join(x for x in [picked["artist"], picked["license"]] if x) or picked["license"],
            "source": picked["descpage"],
        }
        extra = "（无单独封面）"
        if args.cover_width and img.size[0] > args.cover_width:
            ratio = args.cover_width / img.size[0]
            cover = img.resize((args.cover_width, max(1, round(img.size[1] * ratio))), RESAMPLE)
            cdata = encode_webp(cover, args.cover_quality)
            with open(os.path.join(COVER_DIR, name), "wb") as f:
                f.write(cdata)
            cover_total += len(cdata)
            entry["cover"] = f"photos/scenes/cover/{name}"
            extra = f"封面 {cover.size[0]}x{cover.size[1]} {len(cdata)/1024:.0f}KB"

        manifest[code] = entry
        credits[code] = {
            "file": name,
            "title": picked["title"],
            "keyword": used_kw,
            "artist": picked["artist"],
            "license": picked["license"],
            "source": picked["descpage"],
        }
        print(f"[{code:>5}] {name} {img.size[0]}x{img.size[1]} {len(data)/1024:.0f}KB {extra} | {picked['license']} ({time.time()-t0:.1f}s)")

    if args.dry:
        print("\n--dry：未下载任何文件")
        return

    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(manifest.items())), f, ensure_ascii=False, indent=2)

    lines = [
        "# 图片素材署名（Credits）",
        "",
        "偶来小路各条路线的**卡片封面与详情页配图**来自 Wikimedia Commons，均为 CC0 / CC-BY / CC-BY-SA / 公共领域等自由授权作品。",
        "",
        "⚠️ 这些是「该路线所在地点」的风景照，**不是官方路线的官方摄影**，仅用于界面展示。",
        "官方路线图（© Jeju Olle Foundation）另见 `maps.json`，在详情页相册里保留，标注「未经许可禁止商用」。",
        "",
        "| 路线 | 文件 | 作者 | 许可 | 来源页 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for code in sorted(manifest, key=lambda x: (len(x), x)):
        c = credits.get(code)
        if not c:
            e = manifest[code]
            lines.append(f"| {code} | {os.path.basename(e['file'])} | （上一轮抓取，见 manifest.json） | — | {e.get('source', '—')} |")
            continue
        lines.append(f"| {code} | {c['file']} | {c['artist'] or '—'} | {c['license'] or '—'} | {c['source'] or '—'} |")
    lines += [
        "",
        "移除某张图：删掉 `public/photos/scenes/` 下对应文件与 `manifest.json` 里的条目，站点会自动回退到官方路线图封面。",
        "",
        "数据源：https://commons.wikimedia.org（通过官方 MediaWiki API 检索，仅取自由授权作品）",
        "",
    ]
    with open(CREDITS, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    if not args.limit and not args.codes and not args.no_prune:
        keep = {f"olle-{c.replace('-', '_')}.webp" for c in manifest}
        stale = prune(OUT_DIR, keep) + (prune(COVER_DIR, keep) if args.cover_width else [])
        if stale:
            print(f"清理陈图：{', '.join(stale)}")

    print(
        f"\ndone: {len(manifest)} 条有封面（本次新抓 {len(credits)}），"
        f"原图 {full_total/1024/1024:.1f}MB + 封面 {cover_total/1024/1024:.1f}MB，耗时 {time.time()-t_start:.1f}s"
    )
    print(f"-> {OUT_DIR}")
    if failed:
        print(f"本次未取到（可重跑本脚本补）：{', '.join(failed)}")


if __name__ == "__main__":
    main()
