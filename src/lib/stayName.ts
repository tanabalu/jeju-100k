import type { Hotel } from '../types'

/** 住宿显示名优先级：中文 > 英文 > 韩文原名。
 *
 * - nameZh 只放纯中文（地名义译 / 国际品牌官方中文），且已排除「纯地名」这类误导值；
 *   仍为空时回退到 OSM 真实英文名 nameEn（只抄真实拉丁名，不翻译）；
 *   都没有才用韩文原名 name。
 */
export function stayName(h: Pick<Hotel, 'nameZh' | 'nameEn' | 'name'>): string {
  return h.nameZh || h.nameEn || h.name
}

/** 主显示名之外、可作为副行展示的「原名」：主名用了中文/英文时，副行补韩文原名，方便现场问路。 */
export function staySubName(h: Pick<Hotel, 'nameZh' | 'nameEn' | 'name'>): string {
  const main = stayName(h)
  return main !== h.name ? h.name : ''
}
