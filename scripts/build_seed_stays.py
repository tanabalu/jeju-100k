#!/usr/bin/env python3
"""把 public/stays.json 里爬来的住宿，按路线 code 归集进 src/lib/seedStays.ts。

设计：
- 爬来的住宿来自 OSM，是「随包素材」；用户此前要求把它们「回填」进住宿素材管理后台
  （即写成可编辑的一等数据），所以这里生成一份静态 seed 模块，由 seed.ts 的
  buildSeedRoutes() 直接并入各路线 route.hotels。
- 字段对齐 src/types.ts 的 Hotel：id / name(韩文原名) / nameZh(中文名) / lng / lat /
  address / phone / website / note。丢弃 OSM 溯源字段 osmType/osmId（id 已是
  `osm_<type>_<id>` 保留身份）。rating/priceRange OSM 不提供，省略（可选字段）。
- 按 stays.json 的 routeTowns（code -> [韩文城镇]）把 towns 里的住宿归集到每条线；
  同一城镇若被多条线引用，会在对应线各出现一次（与前端 mergeStays 行为一致）。
- 单条线内按 hotel.id 去重，避免重复。
重跑幂等：直接覆盖生成。
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAYS = os.path.join(ROOT, 'public', 'stays.json')
OUT = os.path.join(ROOT, 'src', 'lib', 'seedStays.ts')


def jval(v):
    """渲染成 TS 字面量：字符串用双引号，None/空串省略该字段（由调用方决定）。"""
    if v is None:
        return 'null'
    s = str(v)
    return json.dumps(s, ensure_ascii=False)


def hotel_literal(h):
    parts = []
    parts.append(f'    id: {jval(h.get("id"))}')
    parts.append(f'    name: {jval(h.get("name"))}')
    if h.get('nameZh'):
        parts.append(f'    nameZh: {jval(h.get("nameZh"))}')
    parts.append(f'    lng: {float(h["lng"])!r}')
    parts.append(f'    lat: {float(h["lat"])!r}')
    if h.get('address'):
        parts.append(f'    address: {jval(h.get("address"))}')
    if h.get('phone'):
        parts.append(f'    phone: {jval(h.get("phone"))}')
    if h.get('website'):
        parts.append(f'    website: {jval(h.get("website"))}')
    if h.get('note'):
        parts.append(f'    note: {jval(h.get("note"))}')
    return '  {\n' + ',\n'.join(parts) + ',\n  }'


def main():
    with open(STAYS, encoding='utf-8') as f:
        data = json.load(f)
    towns = {t['ko']: t.get('hotels', []) for t in data.get('towns', [])}
    route_towns = data.get('routeTowns', {})

    seed = {}
    for code, ko_list in route_towns.items():
        seen = set()
        arr = []
        for ko in ko_list:
            for h in towns.get(ko, []):
                hid = h.get('id')
                if not hid or hid in seen:
                    continue
                seen.add(hid)
                arr.append(h)
        if arr:
            seed[code] = arr

    lines = []
    lines.append("// 自动生成，勿手改。来源：public/stays.json（OSM 爬取），由 scripts/build_seed_stays.py 生成。")
    lines.append("// 把爬来的住宿按路线 code 回填进 seed（住宿素材管理后台的可编辑一等数据）。")
    lines.append("// 重跑爬虫后请重跑本脚本；改完以 tsc --noEmit 校验。")
    lines.append("import type { Hotel } from '../types'")
    lines.append('')
    lines.append('export const SEED_STAYS: Record<string, Hotel[]> = {')
    for code in sorted(seed.keys()):
        lines.append(f'  {json.dumps(code)}: [')
        lines.append(',\n'.join(hotel_literal(h) for h in seed[code]))
        lines.append('  ],')
    lines.append('}')
    lines.append('')

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    total = sum(len(v) for v in seed.values())
    print(f'已生成 {OUT}')
    print(f'覆盖路线 {len(seed)} 条，回填住宿 {total} 家')


if __name__ == '__main__':
    main()
