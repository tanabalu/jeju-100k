"""把官方 Route Map PDF 按路线切割成卡片封面图。

数据源：Jeju Olle Foundation 官方《Route Map》（UPDATE 2017.10，共 27 页：第 1 页封面 + 26 页路线图）。

用法：
  python3 split_route_map.py                      # 默认读 ~/Downloads/171011_jeju-olle-route-map.pdf
  python3 split_route_map.py --pdf /path/to.pdf
  python3 split_route_map.py --limit 2            # 只切前两条，用于验证
  python3 split_route_map.py --quality 88         # 提高画质（体积更大）

产出：
  public/photos/maps/olle-<code>.webp   每条路线一页（整页保留，不裁切）
  public/photos/maps.json               前端按路线编号自动绑定为卡片封面

约定：
- 文件里每页右下角印着粗体路线号（如「01」「10-1」），PAGE_CODES 就是照这个顺序整理的，
  换新版 PDF 时**必须重新核对**这张表，否则会把路线号配错。
- 官方 PDF 是 842x595pt 的横版 A4，地图铺满整页，四周仅约 3% 留白；
  裁切会切到路线本体（如 01 线南端、10-1 的济州本岛侧），所以整页保留、不裁切，
  卡片侧用 CSS 的 aspect-ratio 去贴页面比例。
- 这份 PDF 没有 Route 18-2（下楮子岛）的单独页，18-2 走「无封面」占位。
"""

import argparse
import io
import json
import os
import sys
import time

try:
    import pypdfium2 as pdfium
except ImportError:
    sys.exit("缺少依赖：pip install pypdfium2")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "photos", "maps")
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", default=DEFAULT_PDF)
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 条，用于验证")
    ap.add_argument("--scale", type=float, default=1.7, help="渲染倍率（1.0 = 842px 宽）")
    ap.add_argument("--quality", type=int, default=82, help="WebP 质量")
    args = ap.parse_args()

    if not os.path.exists(args.pdf):
        sys.exit(f"找不到 PDF：{args.pdf}")

    pdf = pdfium.PdfDocument(args.pdf)
    need_pages = len(PAGE_CODES) + 1
    if len(pdf) < need_pages:
        sys.exit(f"页数不对：PDF 只有 {len(pdf)} 页，期望至少 {need_pages} 页（1 封面 + {len(PAGE_CODES)} 路线）")

    os.makedirs(OUT_DIR, exist_ok=True)
    codes = PAGE_CODES[: args.limit] if args.limit else PAGE_CODES

    manifest = {}
    total = 0
    t0 = time.time()
    for idx, code in enumerate(codes):
        page = pdf[idx + 1]  # 跳过第 1 页封面
        img = page.render(scale=args.scale).to_pil()
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=args.quality, method=6)
        data = buf.getvalue()

        name = f"olle-{code.replace('-', '_')}.webp"
        with open(os.path.join(OUT_DIR, name), "wb") as f:
            f.write(data)

        zh = CODE_LABEL.get(code, "")
        manifest[code] = {
            "file": f"photos/maps/{name}",
            "caption": f"偶来 {code} 官方路线图{f'（{zh}）' if zh else ''}",
            "credit": CREDIT,
            "source": SOURCE,
        }
        total += len(data)
        print(f"[{code:>5}] {name} {img.size[0]}x{img.size[1]} {len(data) / 1024:.0f}KB")

    if not args.limit:
        with open(MANIFEST, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

    missing = [c for c in PAGE_CODES if c not in manifest]
    print(f"\ndone: {len(manifest)} 张，共 {total / 1024 / 1024:.1f} MB，耗时 {time.time() - t0:.1f}s")
    print(f"-> {OUT_DIR}")
    if missing:
        print(f"本次未生成（--limit）：{', '.join(missing)}")


if __name__ == "__main__":
    main()
