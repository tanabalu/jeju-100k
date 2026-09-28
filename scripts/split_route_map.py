"""把官方 Route Map PDF 按路线切割成「卡片封面（压缩版）+ 详情页原图（高清版）」。

数据源：Jeju Olle Foundation 官方《Route Map》（UPDATE 2017.10，共 27 页：第 1 页封面 + 26 页路线图）。

用法：
  python3 split_route_map.py                      # 默认读 ~/Downloads/171011_jeju-olle-route-map.pdf
  python3 split_route_map.py --pdf /path/to.pdf
  python3 split_route_map.py --limit 2            # 只切前两条，用于验证
  python3 split_route_map.py --quality 88         # 提高原图画质（体积更大）
  python3 split_route_map.py --cover-width 900    # 封面更清晰（体积更大）

产出（同一次渲染出两个尺寸，避免重复解码 PDF）：
  public/photos/maps/olle-<code>.webp        详情页原图：scale 1.7 → 1432px 宽，q82，约 100KB
  public/photos/maps/cover/olle-<code>.webp  卡片封面：760px 宽，q74，约 30KB
  public/photos/maps.json                    { file: 原图, cover: 封面, ... }，前端按编号自动绑定

为什么分两份：
  卡片封面在列表里只渲染到约 300–400px 宽（`grid-template-columns: minmax(min(300px,100%),1fr)`），
  给它 1432px 的原图纯属浪费 —— 首页 26 张封面要拉 2.6MB。封面单独压一份后首屏只要约 0.8MB，
  而详情页（相册 + 灯箱）依旧显示 1432px 原图，放大看地名不受影响。
  压缩是本地做的（Pillow 降尺寸 + WebP 降质），与 TinyPNG / tinyimg 这类在线服务效果同类，
  但不需要 API key、不需要把图片上传到第三方，且可复现。

约定：
- 文件里每页右下角印着粗体路线号（如「01」「10-1」），PAGE_CODES 就是照这个顺序整理的，
  换新版 PDF 时**必须重新核对**这张表，否则会把路线号配错。
- 官方 PDF 是 842x595pt 的横版 A4，地图铺满整页，四周仅约 3% 留白；
  裁切会切到路线本体（如 01 线南端、10-1 的济州本岛侧），所以整页保留、不裁切，
  卡片侧用 CSS 的 aspect-ratio 去贴页面比例。
- 这份 PDF 没有 Route 18-2（下楮子岛）的单独页，18-2 走「无封面」占位。
"""

import argparse
import glob
import io
import json
import os
import sys
import time

try:
    import pypdfium2 as pdfium
except ImportError:
    sys.exit("缺少依赖：pip install pypdfium2")

from PIL import Image

# Pillow >= 9.1 把重采样常量挪进了 Image.Resampling，老版本用顶层别名
try:
    RESAMPLE = Image.Resampling.LANCZOS
except AttributeError:  # pragma: no cover - 兼容旧 Pillow
    RESAMPLE = Image.LANCZOS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "photos", "maps")
COVER_DIR = os.path.join(OUT_DIR, "cover")
MANIFEST = os.path.join(ROOT, "public", "photos", "maps.json")
DEFAULT_PDF = os.path.expanduser("~/Downloads/171011_jeju-olle-route-map.pdf")

# 第 1 页是封面，第 2..27 页依次对应下列路线编号（照每页右下角的路线号核对）
PAGE_CODES = [
    "01", "01-1", "02", "03", "04", "05", "06", "07", "07-1", "08", "09",
    "10", "10-1", "11", "12", "13", "14", "14-1", "15", "16", "17", "18",
    "18-1", "19", "20", "21",
]

SOURCE = "Jeju Olle Foundation《Route Map》官方路线图（UPDATE 2017.10）"
CREDIT = "© Jeju Olle Foundation"

# 路线编号 -> 中文地点名（与 fetch_photos.py 共用一份，避免两处漂移）
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from fetch_photos import CODE_LABEL
except Exception:  # 单独拷贝本脚本时降级为只有编号
    CODE_LABEL = {}


def encode_webp(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def prune(out_dir: str, keep: set) -> list:
    """清掉上一次跑剩下的陈图（只动本脚本产出的 olle-*.webp，不碰别的文件）"""
    removed = []
    for path in glob.glob(os.path.join(out_dir, "olle-*.webp")):
        if os.path.basename(path) not in keep:
            os.remove(path)
            removed.append(os.path.basename(path))
    return removed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", default=DEFAULT_PDF)
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 条，用于验证")
    ap.add_argument("--scale", type=float, default=1.7, help="原图渲染倍率（1.0 = 842px 宽）")
    ap.add_argument("--quality", type=int, default=82, help="原图 WebP 质量")
    ap.add_argument("--cover-width", type=int, default=760, help="封面宽度（px），0 = 不单独出封面")
    ap.add_argument("--cover-quality", type=int, default=74, help="封面 WebP 质量")
    ap.add_argument("--no-prune", action="store_true", help="保留同名目录下的旧图，不做清理")
    args = ap.parse_args()

    if not os.path.exists(args.pdf):
        sys.exit(f"找不到 PDF：{args.pdf}")

    pdf = pdfium.PdfDocument(args.pdf)
    need_pages = len(PAGE_CODES) + 1
    if len(pdf) < need_pages:
        sys.exit(f"页数不对：PDF 只有 {len(pdf)} 页，期望至少 {need_pages} 页（1 封面 + {len(PAGE_CODES)} 路线）")

    os.makedirs(OUT_DIR, exist_ok=True)
    if args.cover_width:
        os.makedirs(COVER_DIR, exist_ok=True)
    codes = PAGE_CODES[: args.limit] if args.limit else PAGE_CODES

    manifest = {}
    full_total = cover_total = 0
    t0 = time.time()
    for idx, code in enumerate(codes):
        page = pdf[idx + 1]  # 跳过第 1 页封面
        img = page.render(scale=args.scale).to_pil()

        name = f"olle-{code.replace('-', '_')}.webp"
        data = encode_webp(img, args.quality)
        with open(os.path.join(OUT_DIR, name), "wb") as f:
            f.write(data)
        full_total += len(data)

        entry = {
            "file": f"photos/maps/{name}",
            "caption": f"偶来 {code} 官方路线图{f'（{CODE_LABEL[code]}）' if CODE_LABEL.get(code) else ''}",
            "credit": CREDIT,
            "source": SOURCE,
        }

        if args.cover_width and img.size[0] > args.cover_width:
            ratio = args.cover_width / img.size[0]
            cover = img.resize(
                (args.cover_width, max(1, round(img.size[1] * ratio))), RESAMPLE
            )
            cdata = encode_webp(cover, args.cover_quality)
            with open(os.path.join(COVER_DIR, name), "wb") as f:
                f.write(cdata)
            cover_total += len(cdata)
            entry["cover"] = f"photos/maps/cover/{name}"
            extra = f"  封面 {cover.size[0]}x{cover.size[1]} {len(cdata) / 1024:.0f}KB"
        else:
            extra = "  （未单独出封面，卡片直接用原图）"

        manifest[code] = entry
        print(f"[{code:>5}] {name} 原图 {img.size[0]}x{img.size[1]} {len(data) / 1024:.0f}KB{extra}")

    if not args.limit:
        with open(MANIFEST, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        if not args.no_prune:
            stale = prune(OUT_DIR, {f"olle-{c.replace('-', '_')}.webp" for c in PAGE_CODES})
            if args.cover_width:
                stale += prune(COVER_DIR, {f"olle-{c.replace('-', '_')}.webp" for c in PAGE_CODES})
            if stale:
                print(f"清理陈图：{', '.join(stale)}")

    print(
        f"\ndone: {len(manifest)} 条，原图 {full_total / 1024 / 1024:.1f} MB"
        f" + 封面 {cover_total / 1024 / 1024:.1f} MB，耗时 {time.time() - t0:.1f}s"
    )
    print(f"-> {OUT_DIR}")
    if args.cover_width:
        print(f"-> {COVER_DIR}")
    missing = [c for c in PAGE_CODES if c not in manifest]
    if missing:
        print(f"本次未生成（--limit）：{', '.join(missing)}")
    no_cover = [c for c, e in manifest.items() if "cover" not in e]
    if no_cover:
        print(f"无单独封面：{', '.join(no_cover)}")


if __name__ == "__main__":
    main()
