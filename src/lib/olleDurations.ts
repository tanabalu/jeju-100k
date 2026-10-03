/**
 * 各线路**官方预估耗时**（济州偶来官方 App「路线」列表页口径，截图录入于 2026-09-30）。
 *
 * ## 口径与纪律
 * - 数据来自官方 App 路线列表页的 ⏱ 标注（如「4-5h」），与官网线路总览同源；
 *   里程一并列官方 App 展示值，便于和站内生效里程对照。
 * - **官方口径优先**：路线卡片 / 详情页 / 行程面板凡有官方耗时，一律显示官方值，
 *   `estimateHours`（里程 / 3.6km/h + 爬升 / 450m/h）只作为无官方数据时的兜底。
 * - 3 号线与 15 号线官方各拆 A/B 两条走法，编号与官方 App 一致（`03-A`/`03-B`、`15-A`/`15-B`）：
 *   **A = 山线**（内陆 / 中山间，翻岳穿林）、**B = 海线**（海岸，几乎没有爬升）。
 *   两条同起终点、是二选一走法，耗时与里程各录官方值。
 * - 1-1 牛岛在 App 里有两个登船口变体（下牛目洞港 / 天津港），耗时相同。
 */

export interface OlleDuration {
  /** 官方耗时区间下限（小时） */
  minH: number
  /** 官方耗时区间上限（小时） */
  maxH: number
  /** 官方 App 列表展示里程（km），仅作对照参考 */
  officialKm?: number
}

export const OLLE_DURATIONS: Record<string, OlleDuration> = {
  '01': { minH: 4, maxH: 5, officialKm: 15.1 },
  '01-1': { minH: 4, maxH: 5, officialKm: 13.2 },
  '02': { minH: 4, maxH: 5, officialKm: 14.8 },
  '03-A': { minH: 6, maxH: 7, officialKm: 20.9 }, // A 山线（内陆·桶岳·独子峰）；难度「上」
  '03-B': { minH: 4, maxH: 5, officialKm: 14.6 }, // B 海线（바당올레·온평숲길→신산포구→신풍신천바다목장）；难度「下」
  '04': { minH: 5, maxH: 6, officialKm: 19.0 },
  '05': { minH: 4, maxH: 5, officialKm: 13.4 },
  '06': { minH: 3, maxH: 4, officialKm: 10.1 },
  '07': { minH: 3, maxH: 4, officialKm: 12.9 },
  '07-1': { minH: 4, maxH: 5, officialKm: 15.7 },
  '08': { minH: 5, maxH: 6, officialKm: 19.3 },
  '09': { minH: 3, maxH: 4, officialKm: 12.3 },
  '10': { minH: 5, maxH: 6, officialKm: 15.6 },
  '10-1': { minH: 1, maxH: 2, officialKm: 4.2 },
  '11': { minH: 5, maxH: 6, officialKm: 17.3 },
  '12': { minH: 5, maxH: 6, officialKm: 17.5 },
  '13': { minH: 4, maxH: 5, officialKm: 16.2 },
  '14': { minH: 6, maxH: 7, officialKm: 19.9 },
  '14-1': { minH: 3, maxH: 4, officialKm: 9.3 },
  '15-A': { minH: 5, maxH: 6, officialKm: 15.5 }, // A 山线（锦山公园·纳邑林道·과오름）；难度「中」
  '15-B': { minH: 4, maxH: 5, officialKm: 13.0 }, // B 海线（한림항→귀덕·곽지→한담산책로→애월→고내포구）；难度「下」
  '16': { minH: 5, maxH: 6, officialKm: 14.8 },
  '17': { minH: 6, maxH: 7, officialKm: 19.5 },
  '18': { minH: 5, maxH: 6, officialKm: 17.1 },
  '18-1': { minH: 4, maxH: 5, officialKm: 11.4 },
  '18-2': { minH: 3, maxH: 4, officialKm: 9.7 },
  '19': { minH: 6, maxH: 7, officialKm: 19.4 },
  '20': { minH: 5, maxH: 6, officialKm: 17.4 },
  '21': { minH: 3, maxH: 4, officialKm: 11.3 },
}

/** 按路线编号取官方耗时；无编号或未录入返回 undefined */
export function officialDuration(code: string | undefined | null): OlleDuration | undefined {
  if (!code) return undefined
  return OLLE_DURATIONS[code]
}

/** 官方耗时区间的展示文案：「4~5h」 */
export function formatDurationRange(d: OlleDuration): string {
  return `${d.minH}~${d.maxH}h`
}
