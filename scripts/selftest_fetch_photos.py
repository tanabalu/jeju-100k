"""离线自测：不联网，只验证挑选/过滤逻辑（许可、构图、地图类排除、排序）。

用法：python3 scripts/selftest_fetch_photos.py
抓图逻辑改之前先跑它；断言 29 条，秒级完成。
"""
import json
import io
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_photos as fp

# 打桩前先留住真实实现：429 退避只存在于里面，打桩版本测不到
ORIG_GET_JSON = fp.get_json

FAKE = {
    "query": {"pages": {
        "p1": {"title": "File:Seongsan Ilchulbong.jpg",  # 标题没写 Jeju，靠描述里的 Jeju 通过「济州相关性」
               "imageinfo": [{"thumburl": "u1", "descriptionurl": "d1", "width": 1600, "height": 1200,
                              "extmetadata": {"Artist": {"value": "Alice"}, "LicenseShortName": {"value": "CC BY-SA 4.0"},
                                              "ImageDescription": {"value": "Seongsan Ilchulbong tuff cone, Jeju Island"}}}]},
        "p2": {"title": "File:Jeju east coast sunrise.jpg",
               "imageinfo": [{"thumburl": "u2", "descriptionurl": "d2", "width": 3000, "height": 2000,
                              "extmetadata": {"Artist": {"value": "Bob"}, "LicenseShortName": {"value": "CC0"}}}]},
        "p3": {"title": "File:Map of Jeju.jpg",
               "imageinfo": [{"thumburl": "u3", "descriptionurl": "d3", "width": 2000, "height": 1500,
                              "extmetadata": {"Artist": {"value": "C"}, "LicenseShortName": {"value": "CC BY 2.0"}}}]},
        "p4": {"title": "File:Some fair use photo.jpg",
               "imageinfo": [{"thumburl": "u4", "descriptionurl": "d4", "width": 2000, "height": 1500,
                              "extmetadata": {"Artist": {"value": "D"}, "LicenseShortName": {"value": "Fair use"}}}]},
        "p5": {"title": "File:Portrait waterfall Jeju.jpg",
               "imageinfo": [{"thumburl": "u5", "descriptionurl": "d5", "width": 1200, "height": 1800,
                              "extmetadata": {"Artist": {"value": "E"}, "LicenseShortName": {"value": "CC BY 3.0"}}}]},
        "p6": {"title": "File:Tiny Jeju.jpg",
               "imageinfo": [{"thumburl": "u6", "descriptionurl": "d6", "width": 800, "height": 600,
                              "extmetadata": {"Artist": {"value": "F"}, "LicenseShortName": {"value": "CC BY 3.0"}}}]},
        "p7": {"title": "File:Jeju rock.jpg",
               "imageinfo": [{"thumburl": "u7", "descriptionurl": "d7", "width": 2000, "height": 1500,
                              "extmetadata": {"Artist": {"value": "G"}}}]},
    }}
}

fp.get_json = lambda opener, params, tries=2: FAKE
res = fp.search(None, "Seongsan Ilchulbong", 1600)
titles = [r["title"] for r in res]

ok = True
def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ") + name)
    ok = ok and cond

check("地图类被排除", not any("Map of Jeju" in t for t in titles))
check("Fair use 被排除", not any("fair use" in t for t in titles))
check("竖构图被排除", not any("Portrait" in t for t in titles))
check("小于 1200px 被排除", not any("Tiny" in t for t in titles))
check("无许可字段被排除", not any("Jeju rock" in t for t in titles))
check("只剩 2 张合格", len(res) == 2)
check("关键词命中优先于泛 Jeju 标题", "Seongsan" in titles[0])
check("选中的是 CC BY-SA 那条", res[0]["license"] == "CC BY-SA 4.0")

# 关键词命中优先：搜索 "Gapado" 时含 Gapado 的排前面
FAKE2 = json.loads(json.dumps(FAKE))
FAKE2["query"]["pages"]["p1"]["title"] = "File:Gapado island.jpg"
fp.get_json = lambda opener, params, tries=2: FAKE2
res2 = fp.search(None, "Gapado", 1600)
check("关键词命中优先", "Gapado" in res2[0]["title"] if res2 else False)

def one_page(title, w, h, license_name="CC BY-SA 4.0", artist="X", desc="A view in Jeju, South Korea"):
    """构造只含一张图的 API 响应"""
    return {"query": {"pages": {"x": {"title": title, "imageinfo": [{
        "thumburl": "u", "descriptionurl": "d", "width": w, "height": h,
        "extmetadata": {"Artist": {"value": artist}, "LicenseShortName": {"value": license_name},
                        "ImageDescription": {"value": desc}},
    }]}}}}


# 近方形（6218×6012）曾经被 12/13/21 三条线同时选中 —— 必须拦掉
fp.get_json = lambda opener, params, tries=2: one_page("File:Bavi 2020-08-25 0435Z.jpg", 6218, 6012, "Public domain")
check("近方形被排除", fp.search(None, "Jeju west coast", 1600, code="12") == [])

# 标题写着别条路线的编号 → 匹配错了（19 线曾选到 "Jejuolle Route 20"）
fp.get_json = lambda opener, params, tries=2: one_page("File:Jejuolle Route 20.jpg", 2797, 1865)
check("路线号不符被排除", fp.search(None, "Gimnyeong beach", 1600, code="19") == [])
check("路线号相符则保留", len(fp.search(None, "Hado", 1600, code="20")) == 1)
# route-18 这种连字符写法也必须拦（16 线曾选到 "Jejuolle-route-18(1)"）
fp.get_json = lambda opener, params, tries=2: one_page("File:Jejuolle-route-18(1).jpg", 2231, 1600)
check("连字符路线号也被拦", fp.search(None, "Handam beach Jeju", 1600, code="16") == [])
check("同一张给 18 线则保留", len(fp.search(None, "Jocheon Jeju", 1600, code="18")) == 1)

# 跟济州无关的图：Commons 模糊检索搜 "Jeju west coast" 会返回这些
for bad_title, bad_desc in [
    ("File:Von Karman Vortices off Canary Islands.jpg", "Swirling cloud patterns off the Canary Islands"),
    ("File:Natural gas pipelines and LNG terminals.webp", "Pipelines and LNG terminals at an industrial port"),
    ("File:ISS039-E-4486 - View of Japan.jpg", "View of Japan from the ISS"),
]:
    fp.get_json = lambda opener, params, tries=2, t=bad_title, d=bad_desc: one_page(t, 4256, 2832, desc=d)
    check(f"非济州图被排除：{bad_title[:38]}", fp.search(None, "Jeju west coast", 1600, code="13") == [])

# 去重：一张图只服务一条线
fp.get_json = lambda opener, params, tries=2: FAKE
used = {"File:Seongsan Ilchulbong.jpg"}
res_used = fp.search(None, "Seongsan Ilchulbong", 1600, code="01", used=used)
check("已选过的图被跳过", res_used and "Seongsan Ilchulbong" not in res_used[0]["title"])
# 候选全被用过时必须返回空，不能退回已用列表（否则 13/21 会撞成同一张图）
all_used = {"File:Seongsan Ilchulbong.jpg", "File:Jeju east coast sunrise.jpg"}
check("候选全用过则返回空", fp.search(None, "Seongsan", 1600, used=all_used) == [])

# 429 限流：要退避重试，而不是直接判这条线「无可用结果」
import urllib.error
class _Resp:
    def __init__(self, payload):
        self.payload = payload
    def read(self):
        return json.dumps(self.payload).encode()
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False

class FlakyOpener:
    def __init__(self, fail_times):
        self.n = fail_times
    def open(self, req, timeout=None):
        if self.n > 0:
            self.n -= 1
            raise urllib.error.HTTPError("http://x", 429, "Too Many Requests", {}, None)
        return _Resp(FAKE)

fp.time.sleep = lambda s: None  # 退避等待在自测里跳过
fp.get_json = ORIG_GET_JSON  # 429 分支只存在于真实实现里，打桩的 lambda 测不到
r = fp.get_json(FlakyOpener(2), {})
check("429 会退避重试后成功", isinstance(r, dict) and "query" in r)

# 编码与尺寸：1600 宽 → 封面 760
from PIL import Image
import io
img = Image.new("RGB", (1600, 1067), (30, 90, 60))
b = fp.encode_webp(img, 82)
check("webp 编码可用", len(b) > 1000)
small = img.resize((760, 507), fp.RESAMPLE)
b2 = fp.encode_webp(small, 74)
check("封面更小", len(b2) < len(b))

# 官方路线照兜底：地标词全落空时，用「路线号」直接找 Commons 的官方路线照
q21 = fp.queries_for("21")
check("路线号照排在泛词之前", q21[-3:] == ["Jeju Olle Route 21", "올레 21코스", "Jeju Olle trail"])
q13 = fp.queries_for("13")
check("13 也有自己的路线号照", q13[-3] == "Jeju Olle Route 13")
check("泛词仍在最后一位", q13[-1] == "Jeju Olle trail")
check("已写过同名兜底词就不重复追加", q13.count("Jeju Olle Route 13") == 1)
check("未知编号也能拿到兜底词", fp.queries_for("99") == ["Jeju Olle Route 99", "올레 99코스"])
# 别条的官方照不能被本条捡走（关键词必须不同：search 按 keyword 缓存，同词会命中上一条的缓存）
fp._cache = {}  # 清掉前面用例塞进内存的检索缓存
fp.get_json = lambda opener, params, tries=2: one_page("File:Jeju Olle Route 21.jpg", 2221, 1593)
check("官方路线照通过路线号校验", len(fp.search(None, "kwA", 1600, code="21")) == 1)
fp._cache = {}
fp.get_json = lambda opener, params, tries=2: one_page("File:Jeju Olle Route 16.jpg", 2221, 1593)
check("别条官方照仍被排除", fp.search(None, "kwB", 1600, code="21") == [])

# 标识牌不是风景（\bsign\b 匹配不到 signage，16 线曾因此选到 Ganse signage 特写）
for bad in ("File:Ganse signage jejuolle-route-16.jpg", "File:Jeju Olle 안내판.jpg", "File:간세 표지판.jpg"):
    fp._cache = {}
    fp.get_json = lambda opener, params, tries=2, _t=bad: one_page(_t, 1897, 1403)
    check(f"标识牌被排除：{bad}", fp.search(None, f"kw{abs(hash(bad))}", 1600, code="16") == [])

# save_image（新增）：下载 → 落盘原图 + 封面。离线桩掉 download，喂一张内存里的 JPEG。
import tempfile as _tf
_buf = io.BytesIO()
Image.new("RGB", (2000, 1333), (10, 120, 80)).save(_buf, "JPEG")
_JPG = _buf.getvalue()
_td = _tf.mkdtemp()
fp.download = lambda opener, url, tries=2: _JPG
_d, _c, _sz = fp.save_image(
    None, {"thumb": "u"}, os.path.join(_td, "a.webp"), os.path.join(_td, "a_c.webp"),
    1600, 82, 760, 74,
)
check("save_image 写原图", os.path.exists(os.path.join(_td, "a.webp")))
check("save_image 写封面", os.path.exists(os.path.join(_td, "a_c.webp")))
check("save_image 按宽度缩放", _sz == (1600, 1066))
check("save_image 封面更小", _c < _d)

print("\nALL PASS" if ok else "\nSOME FAILED")
sys.exit(0 if ok else 1)
