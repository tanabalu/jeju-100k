#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
给 src/data/stays.json 每条住宿生成中文名 nameZh、罗马音 nameRomaja，并按真实业态修正 note。

口径：只补可靠中文，不编造品牌名。**nameZh 只放名称本身，业态写进 note，两处不重复。**
- 业态：从名称里的业态词识别（민박→家庭民宿、펜션→民宿、리조트→度假村…），只写 note。
  OSM 的 tourism 子类型常把 민박 标成 motel，直译出来是「汽车旅馆」，与实情偏差大，
  所以业态一律以名称为准，OSM 分类仅在没有业态词时兜底。
- 地名：济州岛行政区标准汉字（제주→济州、서귀포→西归浦、성산→城山…）。
- 国际品牌：官方中文名（Marriott→万豪、Hyatt→凯悦…）。
- 其余品牌部分（绝大多数是固有词，无对应汉字）只能保留韩文/英文原名，不做音节硬凑的假汉字
  —— 拿去订房、导航、问路都搜不到，属于误导。
- 于是大量 nameZh 会是半中半韩（"西归浦칼"）或中英混排（"JW 万豪 济州"）。这种一律**整条置空**：
  只有纯中文（汉字 + 空格）才写入 nameZh，其余留 null，界面回退显示韩文原名。宁缺，不凑。
- 特例：**品牌整个只是地名**（제주민박→"济州"、한라산호텔→"汉拿山"、Jeju Guest House→"济州"）
  也不写 nameZh —— 翻译出来只是城市/山名，丢失「这是个住宿」的身份，反而误导。
  界面回退时韩文原名仍带着 민박/호텔 业态词，身份清楚。
- nameRomaja：韩文原名按 Revised Romanization 简化转写，便于在韩国地图里搜索。

全量重算，幂等。
"""
import json
import re

SRC = "src/data/stays.json"

# 业态词（韩文 / 英文）→ 中文。按长度降序匹配，长词优先避免误切（콘도미니엄 先于 콘도）。
CATS = [
    ('콘도미니엄', '公寓式酒店'), ('게스트하우스', '民宿'), ('글램핑', '豪华露营'),
    ('민박집', '家庭民宿'), ('캠핑장', '露营地'), ('캠핑', '露营地'),
    ('리조트', '度假村'), ('팬션', '民宿'), ('펜션', '民宿'),
    ('콘도', '公寓式酒店'), ('호스텔', '青年旅舍'), ('호텔', '酒店'),
    ('모텔', '汽车旅馆'), ('민박', '家庭民宿'), ('여관', '旅馆'),
    ('찜질방', '汗蒸房'), ('야영장', '露营地'), ('스파', '水疗'),
]
CATS_EN = [
    ('guesthouse', '民宿'), ('guest house', '民宿'), ('resort', '度假村'),
    ('pension', '民宿'), ('hostel', '青年旅舍'), ('motel', '汽车旅馆'),
    ('hotel', '酒店'), ('condo', '公寓式酒店'), ('camping', '露营地'),
    ('glamping', '豪华露营'), ('spa', '水疗'),
]

# 济州岛行政区 / 景点标准汉字。只放有确定汉字表记的，固有词不进表。
PLACES = [
    ('성산일출봉', '城山日出峰'), ('일출봉', '日出峰'), ('한라산', '汉拿山'),
    ('서귀포', '西归浦'), ('모슬포', '摹瑟浦'), ('추자도', '楸子岛'),
    ('제주시', '济州市'), ('신제주', '新济州'), ('구제주', '旧济州'),
    ('제주', '济州'), ('성산', '城山'), ('표선', '表善'), ('남원', '南元'),
    ('화순', '和顺'), ('무릉', '武陵'), ('저지', '楮旨'), ('한림', '翰林'),
    ('애월', '涯月'), ('김녕', '金宁'), ('우도', '牛岛'), ('함덕', '咸德'),
    ('조천', '朝天'), ('구좌', '旧左'), ('안덕', '安德'), ('대정', '大静'),
    ('한경', '翰京'), ('삼양', '三阳'), ('용담', '龙潭'), ('건입', '健入'),
    ('화북', '禾北'), ('봉개', '凤盖'), ('회천', '回泉'), ('월평', '月坪'),
    ('영평', '营坪'), ('오라', '吾罗'), ('도남', '道南'), ('하모', '下摹'),
    ('이도', '二徒'), ('삼도', '三徒'),
    # 以下只放法定地名（韩国洞·里多有汉字表记）。普通名词不放进来：
    # 해안/해변/폭포/계곡/공원/정원/궁전/숙소 这类意译出来会变成「公园」「岳」这种编造的店名。
]

# 国际连锁 / 已知品牌的官方中文名（英文名匹配，大小写不敏感）。
BRANDS_EN = [
    ('jw marriott', 'JW 万豪'), ('marriott', '万豪'), ('grand hyatt', '君悦'),
    ('park hyatt', '柏悦'), ('hyatt', '凯悦'), ('sheraton', '喜来登'),
    ('ramada', '华美达'), ('hilton', '希尔顿'), ('shilla', '新罗'),
    ('lotte', '乐天'), ('novotel', '诺富特'), ('mercure', '美居'),
    ('ibis', '宜必思'), ('best western', '贝斯特韦斯特'), ('howard johnson', '豪生'),
    ('holiday inn', '假日'), ('intercontinental', '洲际'), ('crowne plaza', '皇冠假日'),
    ('wyndham', '温德姆'), ('pullman', '铂尔曼'), ('sofitel', '索菲特'),
    ('accor', '雅高'), ('kensington', '肯辛顿'), ('paradise', '天堂'),
]

# 英文名里出现的济州地名（OSM 常把名称写成 Jeju / Seogwipo 罗马字）
PLACES_EN = [
    ('jeju', '济州'), ('seogwipo', '西归浦'), ('seongsan', '城山'), ('pyoseon', '表善'),
    ('aewol', '涯月'), ('hallasan', '汉拿山'), ('hamdeok', '咸德'), ('jungmun', '中文'),
    ('gimnyeong', '金宁'), ('namwon', '南元'), ('hanrim', '翰林'), ('udo', '牛岛'),
]

CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ']
JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

# Revised Romanization（简化：终声取代表音，不做全部连音异化）
CHO_R = {'ㄱ': 'g', 'ㄲ': 'kk', 'ㄴ': 'n', 'ㄷ': 'd', 'ㄸ': 'tt', 'ㄹ': 'r', 'ㅁ': 'm',
         'ㅂ': 'b', 'ㅃ': 'pp', 'ㅅ': 's', 'ㅆ': 'ss', 'ㅇ': '', 'ㅈ': 'j', 'ㅉ': 'jj',
         'ㅊ': 'ch', 'ㅋ': 'k', 'ㅌ': 't', 'ㅍ': 'p', 'ㅎ': 'h'}
JUNG_R = {'ㅏ': 'a', 'ㅐ': 'ae', 'ㅑ': 'ya', 'ㅒ': 'yae', 'ㅓ': 'eo', 'ㅔ': 'e', 'ㅕ': 'yeo',
          'ㅖ': 'ye', 'ㅗ': 'o', 'ㅘ': 'wa', 'ㅙ': 'wae', 'ㅚ': 'oe', 'ㅛ': 'yo', 'ㅜ': 'u',
          'ㅝ': 'wo', 'ㅞ': 'we', 'ㅟ': 'wi', 'ㅠ': 'yu', 'ㅡ': 'eu', 'ㅢ': 'ui', 'ㅣ': 'i'}
JONG_R = {'': '', 'ㄱ': 'k', 'ㄲ': 'k', 'ㄳ': 'k', 'ㄴ': 'n', 'ㄵ': 'n', 'ㄶ': 'n', 'ㄷ': 't',
          'ㄹ': 'l', 'ㄺ': 'k', 'ㄻ': 'm', 'ㄼ': 'l', 'ㄽ': 'l', 'ㄾ': 'l', 'ㄿ': 'l', 'ㅀ': 'l',
          'ㅁ': 'm', 'ㅂ': 'p', 'ㅄ': 'p', 'ㅅ': 't', 'ㅆ': 't', 'ㅇ': 'ng', 'ㅈ': 't',
          'ㅊ': 't', 'ㅋ': 'k', 'ㅌ': 't', 'ㅍ': 'p', 'ㅎ': 't'}


def is_hangul(ch: str) -> bool:
    return 0xAC00 <= ord(ch) <= 0xD7A3


def split_syllable(ch: str):
    b = ord(ch) - 0xAC00
    return CHO[b // 588], JUNG[b % 588 // 28], JONG[b % 28]


def romaja(text: str) -> str:
    """韩文 → 罗马音（Revised Romanization 简化版）。非韩文字符原样保留。"""
    out = []
    syl = [split_syllable(c) if is_hangul(c) else None for c in text]
    for i, ch in enumerate(text):
        if not is_hangul(ch):
            out.append(ch)
            continue
        cho, jung, jong = syl[i]
        nxt = syl[i + 1] if i + 1 < len(syl) else None
        # 初声 ㄹ：词首读 r，前面有终声时读 l
        if cho == 'ㄹ':
            prev_jong = syl[i - 1][2] if i > 0 and syl[i - 1] else ''
            lead = 'r' if not prev_jong else 'l'
        else:
            lead = CHO_R[cho]
        vowel = JUNG_R[jung]
        # 终声 ㄹ：后接元音开头音节时读 r，否则读 l
        if jong == 'ㄹ':
            tail = 'r' if (nxt and nxt[0] == 'ㅇ') else 'l'
        else:
            tail = JONG_R[jong]
        out.append(lead + vowel + tail)
    s = ''.join(out)
    return re.sub(r'\s+', ' ', s).strip()


def strip_cat(name: str):
    """剥离业态词，返回 (品牌部分, 业态中文 or None)。业态取最左出现的那个。"""
    low = name.lower()
    hits = []
    for kw, zh in CATS:
        p = name.find(kw)
        if p >= 0:
            hits.append((p, kw, zh))
    for kw, zh in CATS_EN:
        m = re.search(r'\b' + re.escape(kw) + r'\b', low)
        if m:
            hits.append((m.start(), kw, zh))
    if not hits:
        return name, None
    hits.sort(key=lambda x: (-len(x[1]), x[0]))
    # 主业态：出现位置最靠前的那个
    primary = min(hits, key=lambda x: x[0])[2]
    brand = name
    for kw, _zh in CATS:
        brand = brand.replace(kw, ' ')
    for kw, _zh in CATS_EN:
        brand = re.sub(r'\b' + re.escape(kw) + r'\b', ' ', brand, flags=re.I)
    return brand, primary


def apply_places(brand: str) -> str:
    """地名意译：韩文标准汉字 + 英文名里的罗马字地名。"""
    for kw, zh in PLACES:
        brand = brand.replace(kw, zh)
    for kw, zh in PLACES_EN:
        brand = re.sub(r'\b' + re.escape(kw) + r'\b', zh, brand, flags=re.I)
    return brand


def apply_brands_en(brand: str) -> str:
    out = brand
    for kw, zh in BRANDS_EN:
        out = re.sub(re.escape(kw), zh, out, flags=re.I)
    return out


def clean(s: str) -> str:
    s = re.sub(r'\s*[&/]\s*', ' ', s)
    return re.sub(r'\s+', ' ', s).strip(' ·-–')


# OSM 子类型兜底时的措辞收敛（名称里没有业态词时才用到）
NOTE_FALLBACK = {
    '民宿 / Guesthouse': '民宿',
    '公寓式住宿': '公寓式酒店',
}


CJK_ONLY = re.compile(r'^[\u4e00-\u9fff\s]+$')


def pure_zh(s: str):
    """只有纯中文（汉字 + 空格）才要。

    含韩文（"西归浦칼"）、拉丁（"JW 万豪 济州"）、数字的一律不要 —— 半中半韩的名字读着别扭，
    拿去订房导航也搜不到，不如留空让界面显示韩文原名。宁缺，不凑。
    """
    s = (s or '').strip()
    if not s or not CJK_ONLY.match(s):
        return None
    if not any('\u4e00' <= c <= '\u9fff' for c in s):
        return None
    return s


def brand_is_place_only(brand_raw: str) -> bool:
    """品牌部分是否『整个就是地名』（剥离业态词后只剩法定地名，没有实际店名）。

    例：제주민박→品牌'제주'(济州)、한라산호텔→'한라산'(汉拿山)、Jeju Guest House→'Jeju'。
    这种翻译出来只是城市 / 乡镇 / 山名，完全丢失『这是个住宿』的身份，渲染成「济州」
    会让人误以为是地名而非酒店。所以一律留空，让界面回退显示韩文原名
    （韩文原名里还带着 민박/호텔 这类业态词，身份清楚）。
    """
    if not brand_raw.strip():
        return False
    s = brand_raw
    for kw, _ in PLACES:
        s = s.replace(kw, ' ')
    for kw, _ in PLACES_EN:
        s = re.sub(r'\b' + re.escape(kw) + r'\b', ' ', s, flags=re.I)
    # 去掉标点 / 空白后若为空，说明整个品牌就是地名，没有可译的实际店名
    s = re.sub(r'[^A-Za-z가-힣]', '', s)
    return s == ''


def make(hotel: dict):
    name = hotel.get('name') or ''
    # 括号内多是罗马音或英文副名，去掉（罗马音由 nameRomaja 字段提供）
    base = re.sub(r'\([^)]*\)', ' ', name)
    brand, cat = strip_cat(base)
    if cat is None:
        cat = NOTE_FALLBACK.get(hotel.get('note') or '', hotel.get('note') or '')
        brand = base
    brand_raw = brand
    brand = clean(apply_brands_en(apply_places(brand)))
    if not brand:
        brand = clean(apply_places(base))
        brand_raw = base
    # 业态词不进名称：note 字段已经承载它，界面上也是分开显示的，拼进来只会重复
    name_zh = brand or clean(apply_places(base))
    place_only = brand_is_place_only(brand_raw)
    return name_zh, cat, romaja(re.sub(r'\([^)]*\)', ' ', name)), place_only


def main():
    d = json.load(open(SRC, encoding='utf-8'))
    total = 0
    skipped = 0      # 沿用 TourAPI 官方中文名
    blanked = 0      # 生成结果不是纯中文 / 只是地名，置空
    for town in d.get('towns', []):
        for h in town.get('hotels', []):
            total += 1
            zh, cat, rom, place_only = make(h)
            h['nameRomaja'] = rom
            if cat:
                h['note'] = cat
            # 官方中文名（nameZhOfficial，不限来源：TourAPI / 人工核对都打这个标记）才保护，
            # 其余条目走同一口径（剥离业态词 + 地名意译 + 纯中文判定）。
            if h.get('nameZhOfficial'):
                h['nameZh'] = pure_zh(h.get('nameZh'))
                if h['nameZh']:
                    skipped += 1
                continue
            # 普通条目：品牌整个只是地名（济州 / 汉拿山…）不是可用店名，留空；
            # 其余只保留纯中文，半中半韩一律置空。界面回退优先级：中文>英文>韩文。
            if place_only:
                h['nameZh'] = None
                blanked += 1
            else:
                h['nameZh'] = pure_zh(zh)
                if not h['nameZh']:
                    blanked += 1
    json.dump(d, open(SRC, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(
        f'住宿总数={total}，沿用 TourAPI 官方中文名 {skipped} 条，'
        f'有中文名 {total - blanked} 条，地名-only / 非纯中文置空 {blanked} 条'
    )


if __name__ == '__main__':
    main()
