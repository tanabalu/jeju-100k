#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
根据 public/stays.json 生成独立回显预览页 stays_preview.html（项目根目录）。
内联数据，双击即可在浏览器查看（地图 + 按城镇分组列表），不依赖 dev server。
重跑本脚本即可在爬取更新后刷新预览。

用法：
  python3 scripts/gen_stays_preview.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, "..", "public", "stays.json"))
OUT = os.path.normpath(os.path.join(HERE, "..", "stays_preview.html"))


def esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    if not os.path.exists(SRC):
        print("找不到 public/stays.json，先跑 fetch_stays.py", file=__import__("sys").stderr)
        return
    manifest = json.load(open(SRC, encoding="utf-8"))
    towns = manifest.get("towns", [])
    total = sum(t.get("count", len(t.get("hotels", []))) for t in towns)

    # 列表分组 HTML
    sections = []
    for t in towns:
        zh, ko = t.get("zh"), t.get("ko")
        hotels = t.get("hotels", [])
        cards = []
        for h in hotels:
            name = esc(h.get("name"))
            name_zh = esc(h.get("nameZh"))
            disp = name_zh or name
            note = esc(h.get("note"))
            addr = esc(h.get("address"))
            phone = esc(h.get("phone"))
            web = h.get("website")
            lat, lng = h.get("lat"), h.get("lng")
            popup = f"<b>{disp}</b><br>{esc(note)}"
            if name_zh and name_zh != name:
                popup += f"<br><span style='color:#66727f'>{name}</span>"
            if addr:
                popup += f"<br>📍 {addr}"
            if phone:
                popup += f'<br>📞 <a href="tel:{esc(phone)}">{phone}</a>'
            if web:
                popup += f'<br>🔗 <a href="{esc(web)}" target="_blank" rel="noopener">官网</a>'
            cards.append(
                f'<li class="card" data-lat="{lat}" data-lng="{lng}" data-pop="{popup}">'
                f'<div class="nm">{disp}</div>'
                f'{("<div class=\"meta\">" + name + "</div>") if name_zh and name_zh != name else ""}'
                f'<div class="meta">{note}'
                f'{(" · " + addr) if addr else ""}'
                f'{(" · " + phone) if phone else ""}</div>'
                f'{("<div class=\"meta\"><a href=\"" + esc(web) + "\" target=\"_blank\" rel=\"noopener\">官网</a></div>") if web else ""}'
                f"</li>"
            )
        sections.append(
            f'<section class="town"><h2>{esc(zh)}（{esc(ko)}）· {len(hotels)} 家</h2>'
            f'<ul class="grid">{"".join(cards)}</ul></section>'
        )
    list_html = "\n".join(sections) or '<p class="empty">暂无数据</p>'

    meta = (
        f'数据来源：{esc(manifest.get("source"))}<br>'
        f'许可：{esc(manifest.get("license"))}<br>'
        f'生成时间：{esc(manifest.get("generatedAt"))}<br>'
        f'覆盖城镇：{len(towns)} / 17 &nbsp;·&nbsp; 住宿总数：{total} 家<br>'
        f'说明：{esc(manifest.get("note", ""))}'
    )

    html = TEMPLATE.replace("__META__", meta).replace("__LIST__", list_html)
    html = html.replace("__DATA__", json.dumps(manifest, ensure_ascii=False))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"已生成 {OUT}：{len(towns)} 城镇 / {total} 家")


TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>济州偶来沿线住宿 · 爬取回显</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2933; background: #f5f7fa; }
  header { padding: 18px 22px; background: #fff; border-bottom: 1px solid #e4e7eb; }
  h1 { margin: 0 0 8px; font-size: 20px; }
  .meta { font-size: 12px; color: #66727f; line-height: 1.7; }
  #map { height: 420px; width: 100%; }
  main { padding: 18px 22px; }
  .town h2 { font-size: 16px; margin: 22px 0 10px; }
  .grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
  .card { background: #fff; border: 1px solid #e4e7eb; border-radius: 10px; padding: 10px 12px; cursor: pointer; transition: .15s; }
  .card:hover { border-color: #2f80ed; box-shadow: 0 2px 8px rgba(47,128,237,.15); }
  .nm { font-weight: 600; font-size: 14px; }
  .meta, .card .meta { font-size: 12px; color: #66727f; margin-top: 4px; word-break: break-all; }
  .empty { color: #9aa5b1; }
  a { color: #2f80ed; }
</style>
</head>
<body>
<header>
  <h1>济州偶来沿线住宿 · 爬取回显</h1>
  <div class="meta" id="meta">__META__</div>
</header>
<div id="map"></div>
<main>
  <div id="list">__LIST__</div>
</main>
<script>
const STAYS = __DATA__;
const map = L.map('map').setView([33.4, 126.5], 9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18, attribution: '© OpenStreetMap'
}).addTo(map);
const pts = [];
(STAYS.towns || []).forEach(t => {
  (t.hotels || []).forEach(h => {
    if (typeof h.lat === 'number' && typeof h.lng === 'number') {
      const m = L.marker([h.lat, h.lng]).addTo(map);
      const disp = h.nameZh || h.name;
      let html = '<b>' + (disp || '') + '</b><br>' + (h.note || '');
      if (h.nameZh && h.nameZh !== h.name) html += '<br><span style="color:#66727f">' + h.name + '</span>';
      if (h.address) html += '<br>📍 ' + h.address;
      if (h.phone) html += '<br>📞 <a href="tel:' + h.phone + '">' + h.phone + '</a>';
      if (h.website) html += '<br>🔗 <a href="' + h.website + '" target="_blank" rel="noopener">官网</a>';
      m.bindTooltip(disp, { direction: 'top' });
      m.bindPopup(html);
      pts.push([h.lat, h.lng]);
    }
  });
});
if (pts.length) map.fitBounds(pts, { padding: [30, 30] });
// 列表卡片点击 → 地图定位
document.querySelectorAll('.card').forEach(c => {
  c.addEventListener('click', () => {
    const lat = +c.dataset.lat, lng = +c.dataset.lng;
    if (lat && lng) { map.setView([lat, lng], 15); }
  });
});
</script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
