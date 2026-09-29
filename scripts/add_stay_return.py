#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
给 src/lib/tripPlans.ts 每条路线插入 stayReturn（回程住宿）字段。

- 在每条路线的 `back:` 行之后插入 `    stayReturn: '...',`
- 值来自 RET 字典（按终点所在地 + 返程交通推导，均为济州真实城镇，非编造）
- 已是结构化插入，不破坏既有标注 / notes
"""
import re

PATH = 'src/lib/tripPlans.ts'

# code -> 回程住宿建议（韩文（中文）格式，与全站一致）
RET = {
    '01': '성산（城山） 或 제주시（济州市）',
    '01-1': '성산（城山）',
    '02': '성산（城山）',
    '03': '표선（表善） 或 성산（城山）',
    '04': '남원（南元） 或 서귀포（西归浦）',
    '05': '서귀포（西归浦）',
    '06': '서귀포（西归浦）',
    '07': '서귀포（西归浦）',
    '07-1': '서귀포（西归浦）',
    '08': '대평리（大坪里） 或 서귀포（西归浦）',
    '09': '화순（和顺） 或 서귀포（西归浦）',
    '10': '모슬포（摹瑟浦） / 하모（咸摹）',
    '10-1': '가파도（加波岛） 民宿 或 모슬포（摹瑟浦）',
    '11': '모슬포（摹瑟浦）',
    '12': '무릉（武陵） 或 모슬포（摹瑟浦）',
    '13': '저지（楮旨） 或 한림（翰林）',
    '14': '한림（翰林）',
    '14-1': '한림（翰林） 或 저지（楮旨）',
    '15': '애월（涯月） 或 제주시（济州市）',
    '16': '제주시（济州市） 或 애월（涯月）',
    '17': '제주시（济州市）',
    '18': '제주시（济州市）',
    '18-1': '추자도（楸子岛） 상추자항（上楮子港） 附近民宿',
    '18-2': '추자도（楸子岛）',
    '19': '김녕（金宁） 或 제주시（济州市）',
    '20': '김녕（金宁） / 성산（城山） 或 제주시（济州市）',
    '21': '성산（城山） 或 제주시（济州市）',
}

lines = open(PATH, encoding='utf-8').read().split('\n')
out = []
pending = None  # 待插入的 stayReturn 值
for ln in lines:
    out.append(ln)
    m = re.match(r"\s*'([0-9]+(?:-[0-9]+)?)':\s*\{", ln)
    if m and m.group(1) in RET:
        pending = RET[m.group(1)]
        continue
    # 命中 `    back: '...',` 且当前路线有待插入值 → 在其后插入
    if pending is not None and re.match(r"\s*back:\s*'", ln):
        indent = re.match(r"(\s*)", ln).group(1)
        out.append(f"{indent}stayReturn: '{pending}',")
        pending = None
open(PATH, 'w', encoding='utf-8').write('\n'.join(out))
print('已插入 stayReturn 的路线数：', sum(1 for v in RET.values()))
