#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
给 public/stays.json 每条住宿补 nameZh（中文名）。

策略（透明、不编造）：
- 分类词（民宿 / 酒店 / 度假村 …）取自可靠的 note 中文字段；note 缺失时回退到韩文关键词表。
- 品牌名做「韩文音节 → 汉字」音译：拆初声/中声/终声 → 拼音 → 去终声取基底 → 汉字表。
  叠加一批英语借词 / 济州地名的固定映射（济州/西归浦/度假村/豪华…）提升可读度。
- 任何无法可靠音译的音节一律回落韩文原字，绝不给假汉字。
- priceRange / rating 等 OSM 未提供的字段保持 null（由界面标注「暂无」），不编造。

幂等：仅当 nameZh 缺省时写入；--force 覆盖重算。
"""
import json
import re
import sys

SRC = "public/stays.json"

CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ']
JONG = ['', 'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㄹㄱ', 'ㄹㅁ', 'ㄹㅂ', 'ㄹㅅ', 'ㄹㅌ', 'ㄹㅍ', 'ㄹㅎ', 'ㅁ', 'ㅂ', 'ㅂㅅ', 'ㅂㅌ', 'ㅂㅎ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅎ']

INIT_P = {'ㄱ': 'g', 'ㄲ': 'kk', 'ㄴ': 'n', 'ㄷ': 'd', 'ㄸ': 'tt', 'ㄹ': 'r', 'ㅁ': 'm', 'ㅂ': 'b', 'ㅃ': 'pp', 'ㅅ': 's', 'ㅆ': 'ss', 'ㅇ': '', 'ㅈ': 'j', 'ㅉ': 'jj', 'ㅊ': 'ch', 'ㅋ': 'k', 'ㅌ': 't', 'ㅍ': 'p', 'ㅎ': 'h'}
VOW_P = {'ㅏ': 'a', 'ㅐ': 'ae', 'ㅑ': 'ya', 'ㅒ': 'yae', 'ㅓ': 'eo', 'ㅔ': 'e', 'ㅕ': 'yeo', 'ㅖ': 'ye', 'ㅗ': 'o', 'ㅘ': 'wa', 'ㅙ': 'wae', 'ㅚ': 'oe', 'ㅛ': 'yo', 'ㅜ': 'u', 'ㅝ': 'wo', 'ㅞ': 'we', 'ㅟ': 'wi', 'ㅠ': 'yu', 'ㅡ': 'eu', 'ㅢ': 'ui', 'ㅣ': 'i'}
FIN_P = {'': '', 'ㄱ': 'g', 'ㄲ': 'k', 'ㄴ': 'n', 'ㄷ': 't', 'ㄸ': '', 'ㄹ': 'l', 'ㄹㄱ': 'lg', 'ㄹㅁ': 'lm', 'ㄹㅂ': 'lb', 'ㄹㅅ': 'ls', 'ㄹㅌ': 'lt', 'ㄹㅍ': 'lp', 'ㄹㅎ': 'lh', 'ㅁ': 'm', 'ㅂ': 'b', 'ㅂㅅ': 'bs', 'ㅂㅌ': 'bt', 'ㅂㅎ': 'bh', 'ㅅ': 's', 'ㅆ': 'ss', 'ㅇ': 'ng', 'ㅈ': 'j', 'ㅊ': 'ch', 'ㅋ': 'k', 'ㅌ': 't', 'ㅎ': ''}

# 拼音基底（去掉终声）→ 汉字。音译用，一致性优先，非权威汉字。
BASE_HANZI = {
    'a': '雅', 'ae': '爱', 'ba': '巴', 'bae': '倍', 'beo': '柏', 'beu': '弗', 'bi': '飞', 'bo': '宝',
    'byeo': '廉', 'chae': '彩', 'cheo': '次', 'chi': '智', 'cho': '草', 'chu': '秋', 'chyu': '丘',
    'da': '多', 'dae': '大', 'de': '德', 'deo': '德', 'deu': '德', 'di': '地', 'do': '道', 'du': '斗',
    'eo': '御', 'eu': '乙', 'ga': '家', 'gae': '介', 'ge': '季', 'geo': '巨', 'geu': '极', 'gi': '基',
    'go': '高', 'gu': '九', 'gwa': '果', 'gwi': '贵', 'gye': '桂', 'gyeo': '庚',
    'ha': '夏', 'hae': '海', 'he': '慧', 'heo': '许', 'heu': '熙', 'hi': '熙', 'ho': '浩', 'hui': '熙',
    'hwa': '华', 'hyeo': '恤', 'hyu': '休', 'i': '伊', 'ja': '子', 'jae': '在', 'je': '帝', 'jeo': '弟',
    'jeu': '帝', 'ji': '智', 'jji': '智', 'jo': '朝', 'ju': '周', 'jwo': '佐',
    'ka': '卡', 'kae': '凯', 'ke': '桂', 'keu': '克', 'ki': '基', 'kkeo': '巨', 'ko': '高',
    'ma': '马', 'me': '梅', 'mi': '美', 'mo': '慕', 'mu': '武', 'myeo': '苗',
    'na': '罗', 'ne': '来', 'neo': '诺', 'neu': '努', 'ni': '尼', 'no': '鲁', 'nyeo': '女', 'nyu': '纽',
    'o': '吴', 'pa': '派', 'pae': '培', 'pe': '培', 'peo': '表', 'peu': '普', 'pi': '皮', 'po': '浦',
    'ppa': '帕', 'ppeu': '弗', 'pu': '富', 'pyo': '表',
    'ra': '罗', 'rae': '来', 're': '礼', 'reo': '勒', 'reu': '勒', 'ri': '利', 'ro': '鲁', 'ru': '柳',
    'ryeo': '吕', 'sa': '司', 'sae': '赛', 'se': '世', 'seo': '徐', 'seu': '斯', 'si': '诗', 'so': '素',
    'sseo': '西', 'su': '秀', 'sya': '舍', 'syeo': '徐', 'syu': '休',
    'ta': '他', 'tae': '泰', 'te': '泰', 'teo': '太', 'teu': '特', 'ti': '蒂', 'to': '岛', 'tta': '他',
    'tto': '道', 'tu': '图', 'u': '宇', 'ui': '义', 'wa': '瓦', 'we': '月', 'wo': '月', 'ya': '雅',
    'ye': '礼', 'yeo': '吕', 'yo': '瑶', 'yu': '柳',
}

# 英语借词 / 济州地名固定映射（韩文整词 → 中文），优先于逐字音译。
OVERRIDE_BRAND = {
    '제주': '济州', '서귀포': '西归浦', '서귀': '西归', '성산': '城山', '한라': '汉拿', '올레': '偶来',
    '월드': '世界', '파크': '公园', '블루': '蓝', '그린': '绿', '골드': '金', '선셋': '日落', '오션': '海',
    '마운틴': '山', '힐': '丘', '타운': '镇', '빌라': '别墅', '스위트': '套房', '카페': '咖啡馆',
    '해변': '海边', '포레스트': '森林', '가든': '花园', '빌리지': '村', '하우스': '公馆', '럭셔리': '豪华',
    '팰리스': '宫', '호텔': '酒店', '리조트': '度假村', '콘도': '公寓酒店', '캠핑': '露营', '글램핑': '露营',
    '호스텔': '青年旅舍', '펜션': '民宿', '민박': '民宿', '모텔': '汽车旅馆', '게스트하우스': '民宿',
}

# 分类词（韩文 → 中文）；用于从品牌里剥离分类，分类统一由 note 提供。
CAT_KO = ['게스트하우스', '민박집', '민박', '펜션', '리조트', '호텔', '모텔', '호스텔', '콘도미니엄', '콘도', '캠핑장', '글램핑']


def is_hangul(ch: str) -> bool:
    return 0xAC00 <= ord(ch) <= 0xD7A3


def base_of(ch: str) -> str:
    b = ord(ch) - 0xAC00
    c = CHO[b // 588]
    j = JUNG[b % 588 // 28]
    f = JONG[b % 28]
    return (INIT_P[c] + VOW_P[j] + FIN_P[f]).rstrip('bcdfghjklmnpqrstvwxyz')


def hanzi_of(ch: str) -> str:
    """单韩文字节 → 汉字（或原字回落）"""
    if not is_hangul(ch):
        return ch
    hz = BASE_HANZI.get(base_of(ch))
    return hz if hz else ch


def cat_from_note(note: str | None) -> str:
    if not note:
        return ''
    m = re.match(r'[一-鿿]+', note)
    return m.group(0) if m else ''


def transliterate(brand: str) -> str:
    """韩文品牌 → 中文音译（借词/地名优先，余下逐字音译，无法译的回落韩文）"""
    s = brand
    for kw in CAT_KO:
        s = s.replace(kw, ' ')
    for kw, zh in OVERRIDE_BRAND.items():
        s = s.replace(kw, zh)
    out = []
    buf = []
    for ch in s:
        if is_hangul(ch):
            buf.append(hanzi_of(ch))
        else:
            if buf:
                out.append(''.join(buf))
                buf = []
            out.append(ch)
    if buf:
        out.append(''.join(buf))
    return ''.join(out).strip()


def make_name_zh(hotel: dict) -> str:
    name = hotel.get('name') or ''
    cat = cat_from_note(hotel.get('note'))
    if not cat:
        for kw in CAT_KO:
            if kw in name:
                cat = OVERRIDE_BRAND.get(kw, '')
                break
    brand = transliterate(name)
    brand = re.sub(r'\s+', '', brand)
    if brand and cat:
        return f'{brand} {cat}'
    return brand or cat


def main():
    force = '--force' in sys.argv
    d = json.load(open(SRC, encoding='utf-8'))
    total = 0
    filled = 0
    for town in d.get('towns', []):
        for h in town.get('hotels', []):
            total += 1
            if h.get('nameZh') and not force:
                filled += 1
                continue
            h['nameZh'] = make_name_zh(h)
            filled += 1
    json.dump(d, open(SRC, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'住宿总数={total}，已写 nameZh={filled}')


if __name__ == '__main__':
    main()
