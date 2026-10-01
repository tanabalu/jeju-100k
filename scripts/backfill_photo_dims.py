"""把照片的「原始宽高」回填进 manifest.json / maps.json。

为什么需要：详情页相册的加载占位（loading 卡片）要按每张照片的真实比例预留高度，
避免「全部卡片都是同一个 4:5 比例、图片加载完才突然变高」的回流抖动。
但相册图是随包分发的静态资源（kind:'url'），前端在图片真正解码前拿不到尺寸，
所以必须把每张图的原始宽高直接写进原始数据（manifest），前端才能第一时间算对比例。

本脚本只做回填，不重新下载/重编码：直接读 public/photos 下已落的 .webp 文件，
用 Pillow 解析尺寸，写进对应 entry 的 width/height。幂等：已有 width/height 的条目跳过。

用法：
  python3 backfill_photo_dims.py          # 回填全部（manifest.json + maps.json）
  python3 backfill_photo_dims.py --check  # 只报告缺尺寸的条目，不改文件
"""

import argparse
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "public", "photos", "manifest.json")
MAPS = os.path.join(ROOT, "public", "photos", "maps.json")

# 站点根目录下的相对路径（manifest 里就是这么写的）补成磁盘绝对路径
def disk_path(site_rel: str) -> str:
    # manifest 写的是 "photos/scenes/olle-01.webp"（相对站点根），
    # 磁盘上位于 public/photos/...，所以前面补 public/
    return os.path.join(ROOT, "public", site_rel) if not site_rel.startswith("public/") else os.path.join(ROOT, site_rel)


def dims_of(site_rel: str):
    """读一张图的宽高；读不到返回 None（文件缺失/损坏，不阻塞其余回填）"""
    p = disk_path(site_rel)
    if not os.path.exists(p):
        print(f"  ⚠ 找不到文件，跳过：{site_rel}", file=sys.stderr)
        return None
    try:
        with Image.open(p) as im:
            return im.width, im.height
    except Exception as e:  # 解码失败等
        print(f"  ⚠ 读取尺寸失败，跳过：{site_rel} ({e})", file=sys.stderr)
        return None


def backfill_entry(entry: dict, field_keys: list[str], dry: bool, tag: str) -> bool:
    """给单个 entry 的若干图片字段（file / cover / gallery[].file）补 width/height。
    返回是否改动了（仅用于 --check 统计）"""
    changed = False
    for key in field_keys:
        if key == "gallery":
            gals = entry.get("gallery") or []
            for g in gals:
                if g.get("width") and g.get("height"):
                    continue
                d = dims_of(g["file"])
                if d:
                    if not dry:
                        g["width"], g["height"] = d
                    changed = True
            continue
        if key not in entry:
            continue
        if entry.get("width") and entry.get("height"):
            continue
        d = dims_of(entry[key])
        if d:
            if not dry:
                entry["width"], entry["height"] = d
            changed = True
    return changed


def process(path: str, field_keys: list[str], dry: bool):
    if not os.path.exists(path):
        print(f"跳过（不存在）：{os.path.relpath(path, ROOT)}")
        return
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    total = missing_before = missing_after = 0
    for code, entry in data.items():
        # 统计该 entry 是否「缺尺寸」（拿不到任意一张主图的尺寸就算缺）
        def has_dims(e):
            return bool(e.get("width") and e.get("height"))
        def all_gal_ok(e):
            gals = e.get("gallery") or []
            return all((g.get("width") and g.get("height")) for g in gals)
        total += 1
        if not (has_dims(entry) and all_gal_ok(entry)):
            missing_before += 1
        backfill_entry(entry, field_keys, dry, code)
        if not (has_dims(entry) and all_gal_ok(entry)):
            missing_after += 1

    if dry:
        print(f"{os.path.relpath(path, ROOT)}：{total} 条，缺尺寸 {missing_before} 条（不改文件）")
    else:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"{os.path.relpath(path, ROOT)}：{total} 条，回填 {missing_before} 条（剩余缺尺寸 {missing_after} 条）")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只报告缺尺寸的条目，不改文件")
    args = ap.parse_args()
    # file + gallery 进相册（详情页相册网格 / 灯箱）；cover 仅做卡片封面（固定高度容器，可选补）
    process(MANIFEST, ["file", "gallery", "cover"], args.check)
    # 地图只有 file 进相册
    process(MAPS, ["file"], args.check)


if __name__ == "__main__":
    main()
