/**
 * 住宿名称检索（纯函数）。
 *
 * ## 为什么要单独抽出来
 * 「详情页住宿抽屉」和「行程篮住哪抽屉」是两套 UI，但搜索规则必须一致 ——
 * 否则同一个名字在这个抽屉搜得到、换个入口就搜不到。
 *
 * ## 匹配哪些字段
 * 一家住宿在系统里可能同时有四个名字：
 * - `name` 韩文原名（OSM 的 name，必有）；
 * - `nameZh` 中文名（只补可靠意译，覆盖很少，多数为 null）；
 * - `nameEn` 英文名（只抄 OSM 真实拉丁名，**不翻译、不罗马转写**，覆盖率低）；
 * - `nameRomaja` 韩文原名的罗马音（100% 覆盖，键盘打得出的那一串）。
 *
 * 所以用英文/拉丁字母检索时，实际参与匹配的是 `nameEn` + `nameRomaja` +
 * `name` 里本来就夹着的拉丁词（如 "CF motel"、"New crown hotel"）。
 *
 * ## 英文/拉丁拼写差异为什么要在搜索层兜
 * OSM 给的多是韩式罗马音（펜션 → `pensyeon`、리조트 → `rijoteu`、게스트하우스 → `geseuteuhauseu`），
 * 而用户在地图和订房网站上看到/搜的是惯用英文拼写（`pension`、`resort`、`guesthouse`） ——
 * 全岛 774 家里有 125 家的名字里写着 `pensyeon`，直接搜 `pension` 一家都搜不到。
 * 所以这里再做一层**同词异写**归一：不是翻译业态，只是把同一个词的两套写法并起来。
 *
 * ## 匹配规则
 * - 大小写不敏感；
 * - 忽略空格与连字符等分隔符号（"RamadaPlaza" 能命中 "Ramada Plaza Jeju"）；
 * - 多个词是**且**关系，且不要求顺序（"jeju hyatt" 能命中 "Grand Hyatt Jeju"）；
 * - 归一串是**追加**、不覆盖原文：搜 `pensyeon` 和搜 `pension` 都能命中同一家。
 */
import type { Hotel } from '../types'

/**
 * 归一化：小写 + 去掉空格与常见分隔符。
 *
 * **大小写在这里一次性归零**（`toLowerCase` 在函数内部，调用方不用自己记），
 * 关键词和待匹配字段都过一遍 —— 所以 `RAMADA` / `Ramada` / `ramada` 命中的是同一批。
 * 韩文没有大小写概念，这一层对韩文无副作用（汉字同理）。
 *
 * 纪律：新增字段时直接塞进 `haystack` 的数组里，**不要在外面另写 `indexOf`/`includes`**，
 * 否则会绕过这里的大小写归零，退化成大小写敏感。
 */
function fold(s: string): string {
  return s.toLowerCase().replace(/[\s\-_.,'‘’"“”()/\\&·]+/g, '')
}

/** 同一个词在韩式罗马音与英文惯用拼写下的两种写法（按实测数据整理，见文件头） */
const SPELLING_VARIANTS: [RegExp, string][] = [
  [/pensyeon|penseon/g, 'pension'],
  [/rijoteu|risoteu|lijoteu/g, 'resort'],
  [/kondo/g, 'condo'],
  [/geseuteuhauseu?/g, 'guesthouse'],
  [/hoseutel/g, 'hostel'],
  [/yeogwan|yeoinsuk/g, 'inn'],
]

/** 罗马音 → 惯用拼写。原串没变就不必返回第二份 */
function variants(s: string): string | null {
  let out = s
  for (const [from, to] of SPELLING_VARIANTS) out = out.replace(from, to)
  return out === s ? null : out
}

/** 参与检索的字段（空字段不入列，有拼写差异的追加一份归一串） */
function haystack(hotel: Hotel): string[] {
  const raw = [hotel.name, hotel.nameZh, hotel.nameEn, hotel.nameRomaja]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map(fold)
  const extra = raw.map(variants).filter((v): v is string => v !== null)
  return [...raw, ...extra]
}

/**
 * 住宿名是否命中关键词。
 *
 * - **不区分大小写**：`fold` 内部统一小写，`JeJu` / `jeju` / `JEJU` 结果完全一致；
 * - 空关键词一律算命中（由调用方决定要不要过滤）。
 */
export function matchStayName(hotel: Hotel, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/[\s\u00a0]+/).filter(Boolean)
  if (tokens.length === 0) return true
  const fields = haystack(hotel)
  return tokens.every((raw) => {
    const n = fold(raw)
    const alt = variants(n)
    return fields.some((f) => f.includes(n) || (alt !== null && f.includes(alt)))
  })
}
