#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
给 src/data/stays.json 每条住宿补 nameEn（真实英文名）。

口径：只抄 OSM 里本来就存在的拉丁字母名称，不翻译、不转写、不猜测。
- 名称本身是拉丁字母（OSM 的 name 就是英文）→ 原样照抄。
- 名称带括号、括号里是拉丁串 → 抄括号内容，但要求含英语住宿用词；
  纯罗马音串（Haeddeuneunjip 之类）不填 —— 那是韩语罗马转写，不是英文，
  它的位置在 nameRomaja。
- 韩英混合（「JW Marriott Jeju Resort & Spa - JW 메리어트…」）→ 只取成段的英文部分；
  「CF 모텔」「제주JJ게스트하우스」这种拉丁只是缩写碎片，不构成英文名，不填。
- 其余 OSM 没记录拉丁名的一律留空（null）。

幂等：全量重算。
"""
import json
import re

SRC = "src/data/stays.json"

# 英语 / 国际通用住宿用词：用来判断一段拉丁串到底是英文名还是韩语罗马转写。
# pansion / pensyeon 是 pension 的韩式拼写，订房平台上大量这样写，算。
EN_WORDS = [
    'hotel', 'motel', 'pension', 'pansion', 'homestay', 'home stay', 'guesthouse',
    'guest house', 'house', 'resort', 'villa', 'village', 'castle', 'palace', 'inn',
    'hostel', 'condo', 'apartment', 'suite', 'beach', 'garden', 'park', 'plaza',
    'spa', 'hill', 'town', 'blue', 'green', 'royal', 'sunrise', 'sunset', 'ocean',
    'sea', 'mountain', 'stay', 'maison', 'hotel', 'jeju', 'marriott', 'hyatt',
    'ramada', 'shilla', 'lotte', 'hilton', 'sheraton', 'guesthouse', 'pension',
]

LATIN_ONLY = re.compile(r"[A-Za-z0-9\s&'\.\-]+")


def has_en_word(s: str) -> bool:
    low = s.lower()
    return any(w in low for w in EN_WORDS)


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', s).strip(" -–·'")


def pick_en(name: str):
    """从 OSM 原始名称里挑出真实英文名；挑不出就返回 None。"""
    n = name.strip()
    if not n:
        return None
    # 1) 名称本身就是拉丁字母 —— OSM 的 name 即英文名
    if LATIN_ONLY.fullmatch(n) and re.search(r'[A-Za-z]', n):
        return clean(n)
    # 2) 括号里带拉丁串
    m = re.search(r'\(([^)]*)\)', n)
    if m and re.search(r'[A-Za-z]', m.group(1)):
        inner = clean(m.group(1))
        if inner and has_en_word(inner):
            return inner
    # 3) 韩英混合：取以连字符 / 斜杠分隔的纯拉丁片段
    for part in re.split(r'[-–/|]', n):
        p = clean(part)
        if p and LATIN_ONLY.fullmatch(p) and re.search(r'[A-Za-z]', p) and has_en_word(p):
            return p
    return None


def main():
    d = json.load(open(SRC, encoding='utf-8'))
    total = 0
    got = 0
    for town in d.get('towns', []):
        for h in town.get('hotels', []):
            total += 1
            # 只有官方英文名（nameZhOfficial 同类的 nameEnOfficial）才保护；
            # 其余 TourAPI 条目照样从名称里挑真实拉丁名，挑不到就留空。
            if h.get('nameEnOfficial'):
                got += 1
                continue
            en = pick_en(h.get('name') or '')
            if en:
                h['nameEn'] = en
                got += 1
            else:
                h['nameEn'] = None
    json.dump(d, open(SRC, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'住宿总数={total}，取到真实英文名={got}，留空={total - got}')


if __name__ == '__main__':
    main()
