import type { Hotel, Plan, Route, RouteMetrics } from '../types'
import { formatKm } from '../lib/geo'
import { stayName } from '../lib/stayName'
import {
  addHours,
  dayDepartureH,
  dayFinishH,
  dayIslandExtraH,
  dayWakeH,
  estimateHours,
  fmtClock,
  formatHours,
  islandExtraH,
  islandZh,
  isIslandRoute,
  routeEnds,
  type DayPlan,
  type PlanRow,
} from '../lib/dayPlan'
import { STAY_SEARCH_KM, type PrevStaySuggestion, type StaySuggestion } from '../lib/stayMatch'
import { officialDuration } from '../lib/olleDurations'
import styles from './PlanPrintSheet.module.less'

export interface PlanPrintSheetProps {
  plan: Plan
  rows: PlanRow[]
  days: DayPlan[]
  stays: Map<number, StaySuggestion | null>
  /** 「出发前一晚」的住宿建议 */
  prevNight: PrevStaySuggestion | null
  /** 「出发前一晚」对应的日期标签（没填出发日就是空串） */
  prevLabel?: string
  metrics: Map<string, RouteMetrics>
}

/** 路线在行程单上的短标签：有编号用「20号线」，自定义路线退回名称 */
function routeLabel(r: Route): string {
  return r.code ? `${r.code}号线` : r.name
}

/**
 * 住宿在行程单上的名字：用优先级选出的主名（中文 > 英文 > 韩文），并括注韩文原名。
 * 打印版是要带在路上用的，问路 / 给司机看时原名比中文名管用。
 */
function stayPrintName(h: Hotel): string {
  const main = stayName(h)
  return main !== h.name ? `${main}（${h.name}）` : main
}

/** 难度数字 → 文案（1-5；站内 seed 只用到 2/3/4） */
function difficultyText(n: number): string {
  if (n <= 2) return '低'
  if (n === 3) return '中等'
  if (n === 4) return '中高'
  return '高'
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
function circled(i: number): string {
  return CIRCLED[i] ?? `(${i + 1})`
}

/**
 * 行程单：给「打印 / 存 PDF」以及「存为图片」共用的那一版渲染。
 *
 * ## 版式
 * 「Day 卡片 + 胶囊标签」：一天一张圆角卡，左侧一条强调色边条（按天循环换色），
 * 卡内自上而下 = 标题行（Day N · 路线号 + 当天起终点 + 日期）→ 统计行（里程 / 官方耗时 /
 * 难度 / 爬升 / 区域）→ 行程胶囊（每条路线一枚）→ ⚠️ 提示与备注 → 🛏 住宿建议。
 * 移动端与桌面端同一套 DOM，样式见 PlanPrintSheet.module.less。
 *
 * ## 两套导出路径
 * - 桌面端：用浏览器自带的「打印 → 存为 PDF」，矢量文字、可选中复制、体积小、能搜。
 *   排版交给 `@media print`（见 styles/print.less）。
 * - 移动端：手机浏览器唤不起 PDF 保存的系统弹窗，所以改成把这份行程单渲染成图片、
 *   再走系统分享面板存到相册（见 PlanPage 的 saveAsImage，截图用 html-to-image）。
 *
 * 行程单本身是纯文本 + 系统字体、没有任何外链图片/字体，
 * 正好避开了 html-to-image 最容易踩的「跨域图片 / 中文字体缺失」两个坑。
 * 这里只负责结构与内容，不关心最终是 PDF 还是图片。
 */
export function PlanPrintSheet({
  plan,
  rows,
  days,
  stays,
  prevNight,
  prevLabel,
  metrics,
}: PlanPrintSheetProps) {
  const totalKm = rows.reduce((s, r) => s + r.km, 0)
  const gains = rows.map((r) => r.gainM).filter((g): g is number => typeof g === 'number' && Number.isFinite(g))
  const totalGain = gains.length ? gains.reduce((a, b) => a + b, 0) : null
  // 有徒步路线的天：用于「出发前一晚」的「次日从哪开走」引用（必须有路线才有起点）
  const routeDays = days.filter((d) => d.rows.length > 0)
  // 真正要印进行程单的天：有路线的天 + 没有路线但写了「当天备注」的空天
  // （自由活动 / 交通 / 休整日，不绑任何偶来徒步，但备注要随行程单带走）
  const hasDayNote = (day: number) => (plan.dayNotes?.[day] ?? '').trim().length > 0
  const printDays = days.filter((d) => d.rows.length > 0 || hasDayNote(d.day))
  const dayCount = printDays.length
  const firstRouteDay = routeDays[0]
  const firstPrintDay = printDays[0]
  const lastFn = [...printDays].reverse()[0]
  // 住几晚：出发前一晚 + 印进行程单的每一天当晚（最后一天也算 —— 那晚也要落脚）
  const nights = dayCount > 0 ? dayCount + 1 : 0

  return (
    <div className={`${styles.sheet}`}>
      <div className={`${styles.head}`}>
        <h1>{plan.name}</h1>
        <div className={`${styles.sub}`}>
          {firstPrintDay?.dateISO && <span>出发日 {firstPrintDay.dateISO}（{firstPrintDay.weekday}）</span>}
          <span>共 {dayCount} 天</span>
          <span><b>{formatKm(totalKm)}</b> km</span>
          {totalGain !== null && <span>累计爬升 {Math.round(totalGain)} m</span>}
          <span>{nights} 晚住宿</span>
          {lastFn?.dateISO && lastFn.dateISO !== firstPrintDay?.dateISO && <span>至 {lastFn.dateISO}</span>}
        </div>
      </div>

      {/* 出发前一晚：单独一栏 —— 它不属于任何一天，第二天一早就要从第一天起点开走 */}
      {firstRouteDay && (
        <section className={`${styles.day} ${styles['day-prev']}`}>
          <div className={`${styles['day-head']}`}>
            <span className={`${styles['day-title']}`}>出发前一晚</span>
            {prevLabel && <span className={`${styles['day-ends']}`}>· {prevLabel}</span>}
          </div>
          <div className={`${styles['day-ends']}`}>
            次日从「{firstRouteDay.rows[0].route.startPoint?.name ?? firstRouteDay.rows[0].route.name}」开走
          </div>
          {prevNight ? (
            <>
              <div className={`${styles.line}`}>
                🛏 <b>建议住：{prevNight.area}</b>
                {prevNight.lockedHotel && <span> —— 已定：{stayPrintName(prevNight.lockedHotel)}</span>}
              </div>
              <div className={`${styles['line-sub']}`}>{prevNight.reason}</div>
              {prevNight.candidates.length > 0 && (
                <div className={`${styles['line-sub']}`}>
                  候选（离第一天出发点 {STAY_SEARCH_KM} km 内由近及远）：
                  {prevNight.candidates
                    .slice(0, 3)
                    .map((c) => stayPrintName(c.hotel) + (c.hotel.priceRange ? `（${c.hotel.priceRange}）` : ''))
                    .join(' · ')}
                </div>
              )}
            </>
          ) : (
            <div className={`${styles.line}`}>🛏 暂无前夜住宿数据可推荐</div>
          )}
          {plan.prevStayNote && (
            <div className={`${styles['day-note']}`}>📝 备注：{plan.prevStayNote}</div>
          )}
        </section>
      )}

      {printDays.map((d, idx) => {
        /* 空天（无偶来徒步路线）：只印当天备注，作为「自由活动 / 交通 / 休整」单独成节，
           不依赖任何路线 —— 彻底解耦「没排路线的天就看不到备注」的旧行为 */
        if (d.rows.length === 0) {
          return (
            <section
              className={`${styles.day} ${styles['day-free']} ${styles[`c${idx % 6}`]}`}
              key={d.day}
            >
              <div className={`${styles['day-head']}`}>
                <span className={`${styles['day-title']}`}>
                  Day {d.day} · <em>自由活动 / 交通 / 休整</em>
                </span>
                {d.dateISO && (
                  <span className={`${styles['day-date']}`}>{d.dateISO} {d.weekday}</span>
                )}
              </div>
              {plan.dayNotes?.[d.day] && (
                <div className={`${styles['day-note']}`}>📝 备注：{plan.dayNotes[d.day]}</div>
              )}
            </section>
          )
        }
        const stay = stays.get(d.day) ?? null
        const firstRow = d.rows[0]
        const lastRow = d.rows[d.rows.length - 1]
        const dayStart = routeEnds(firstRow.route, metrics.get(firstRow.route.id)).start
        const dayEnd = routeEnds(lastRow.route, metrics.get(lastRow.route.id)).end
        const labels = d.rows.map((r) => routeLabel(r.route)).join(' + ')
        const regions = [...new Set(d.rows.map((r) => r.route.region).filter(Boolean))]
        /* 官方耗时优先：当天每条都有官方区间就相加成「官方 X~Yh」，否则退回估算值 */
        const officials = d.rows.map((r) => officialDuration(r.route.code))
        const allOfficial = officials.every((o) => !!o)
        const durText = allOfficial
          ? `官方 ${officials.reduce((s, o) => s + (o?.minH ?? 0), 0)}~${officials.reduce((s, o) => s + (o?.maxH ?? 0), 0)}h`
          : `约 ${formatHours(d.hours)}`

        /* 时间轴：收工时刻按「一天一条线 16:00 / 两条及以上 17:00」锚定，起床由收工倒推。
           当天若有离岛线，总占用时长 = 步行 + 离岛额外（买票+排队+坐船往返），
           每段时刻由「出发时刻 + 逐段累加」得，最后一块正好落在收工时刻 */
        const islandExtra = dayIslandExtraH(d.rows)
        const effHours = d.hours + islandExtra
        const departH = dayDepartureH(effHours, d.rows.length)
        const wakeH = dayWakeH(effHours, d.rows.length)
        const finishH = dayFinishH(d.rows.length)

        /* 时间块：每条离岛线之前插入「坐船+买票排队（含往返）」块，
           步行块按「出发 + 逐段累加估算步行时长」排，保证最后一块结束 = 收工时刻 */
        type ChipItem =
          | { kind: 'ferry'; row: PlanRow; start: number; end: number }
          | { kind: 'walk'; row: PlanRow; start: number; end: number; no: number }
        let cursor = departH
        let walkNo = 0
        const chipItems: ChipItem[] = []
        for (const r of d.rows) {
          if (isIslandRoute(r.route)) {
            const fe = islandExtraH(r.route)
            const fs = cursor
            const feEnd = addHours(cursor, fe)
            cursor = feEnd
            chipItems.push({ kind: 'ferry', row: r, start: fs, end: feEnd })
          }
          const h = estimateHours(r.km, r.gainM)
          const ws = cursor
          const we = addHours(cursor, h)
          cursor = we
          walkNo++
          chipItems.push({ kind: 'walk', row: r, start: ws, end: we, no: walkNo - 1 })
        }

        return (
          <section className={`${styles.day} ${styles[`c${idx % 6}`]}`} key={d.day}>
            <div className={`${styles['day-head']}`}>
              <span className={`${styles['day-title']}`}>
                Day {d.day} · <em>{labels}</em>
              </span>
              <span className={`${styles['day-ends']}`}>
                {dayStart?.name ?? '—'} → {dayEnd?.name ?? '—'}
              </span>
              {d.dateISO && (
                <span className={`${styles['day-date']}`}>{d.dateISO} {d.weekday}</span>
              )}
            </div>
            <div className={`${styles.timeline}`}>
              <span className={`${styles['time-tag']} ${styles['time-wake']}`}>
                🌅 起床 {fmtClock(wakeH)}
              </span>
              <span className={`${styles['time-tag']} ${styles['time-go']}`}>
                🚶 出发 {fmtClock(departH)}
              </span>
              <span className={`${styles['time-tag']} ${styles['time-end']}`}>
                🏁 收工 {fmtClock(finishH)}
              </span>
            </div>
            {islandExtra > 0 && (
              <div className={`${styles['island-note']}`}>
                🚢 含离岛交通（买票+排队+坐船往返）约 {formatHours(islandExtra)}
              </div>
            )}
            <div className={`${styles['day-stats']}`}>
              <b>{formatKm(d.distanceKm)} km</b>
              <span> · {durText}</span>
              {d.difficultyMax > 0 && <span> · 难度{difficultyText(d.difficultyMax)}</span>}
              {d.gainM !== null && <span> · 累计爬升 {Math.round(d.gainM)} m</span>}
              {regions.length > 0 && <span> · {regions.join(' + ')}</span>}
            </div>
            <div className={`${styles.chips}`}>
              {chipItems.map((c) =>
                c.kind === 'ferry' ? (
                  <span className={`${styles.chip} ${styles['chip-ferry']}`} key={`ferry-${c.row.route.id}`}>
                    🚢 <b>坐船+买票排队（{islandZh(c.row.route)}往返）</b>
                    <span className={`${styles['chip-time']}`}>{fmtClock(c.start)}–{fmtClock(c.end)}</span>
                  </span>
                ) : (
                  <span className={`${styles.chip}`} key={c.row.route.id}>
                    <b>{circled(c.no)} {routeLabel(c.row.route)}</b>
                    <span className={`${styles['chip-time']}`}>
                      {fmtClock(c.start)}–{fmtClock(c.end)}
                    </span>
                    {' '}{formatKm(c.row.km)} km
                    {c.row.gainM != null && <> ↑{Math.round(c.row.gainM)}m</>}
                  </span>
                ),
              )}
            </div>
            {d.warnings.map((w, i) => (
              <div className={`${styles['day-warn']}`} key={`${w.kind}-${i}`}>
                ⚠️ {w.text}
              </div>
            ))}
            {plan.dayNotes?.[d.day] && (
              <div className={`${styles['day-note']}`}>📝 备注：{plan.dayNotes[d.day]}</div>
            )}
            {stay ? (
              <>
                <div className={`${styles.line}`}>
                  🛏 <b>建议住：{stay.area}</b>
                  {d.isLast && <span>（最后一晚）</span>}
                  {stay.lockedHotel && <span> —— 已定：{stayPrintName(stay.lockedHotel)}</span>}
                </div>
                <div className={`${styles['line-sub']}`}>{stay.reason}</div>
                {stay.altArea && (
                  <div className={`${styles['line-sub']}`}>
                    备选：{stay.altArea} —— {stay.altReason}
                  </div>
                )}
                {stay.candidates.length > 0 && (
                  <div className={`${styles['line-sub']}`}>
                    候选（离今晚终点 {STAY_SEARCH_KM} km 内、加权距离排序）：
                    {stay.candidates
                      .slice(0, 3)
                      .map((c) => stayPrintName(c.hotel) + (c.hotel.priceRange ? `（${c.hotel.priceRange}）` : ''))
                      .join(' · ')}
                  </div>
                )}
              </>
            ) : (
              <div className={`${styles.line}`}>🛏 暂无住宿数据可推荐</div>
            )}
          </section>
        )
      })}

      <div className={`${styles.foot}`}>
        里程取自各路线实测/手填口径，耗时为官方建议（缺官方数据时按「平地 3.6 km/h + 每 450 m 爬升折 1 小时」估算），
        请以官方建议为准；交通班次请在出发前自行复核。
        行程单上的起床 / 出发 / 收工及每段时刻按「一天一条线 16:00 收工、两条及以上 17:00 收工」倒推（起床到出发含 2.5h 早餐与去程缓冲）；含离岛线的当天已额外计入「买票+排队+坐船往返」的估算时长（各岛船班受季节与潮汐影响很大，以出发前实际为准）。不含岛外交通接驳与途中休息，仅供排程参考。
      </div>
    </div>
  )
}
