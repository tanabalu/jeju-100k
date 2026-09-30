import type { Plan, RouteMetrics } from '../types'
import { formatKm } from '../lib/geo'
import { formatHours, type DayPlan, type PlanRow } from '../lib/dayPlan'
import { STAY_SEARCH_KM, type PrevStaySuggestion, type StaySuggestion } from '../lib/stayMatch'
import { routeEnds } from '../lib/dayPlan'
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

/**
 * 行程单：给「打印 / 存 PDF」用的那一版渲染。
 *
 * ## 为什么不做图片导出
 * 少一个依赖（html-to-image / html2canvas 都要 40KB 起，且中文字体、跨域图片都是坑），
 * 浏览器自带的「打印 → 存为 PDF」出来的就是矢量文字，选中可复制、体积小、还能搜。
 * 排版交给 `@media print`（见 styles/print.less），这里只负责结构与内容。
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
  const usedDays = days.filter((d) => d.rows.length > 0)
  const dayCount = usedDays.length
  const first = usedDays[0]
  const lastFn = [...usedDays].reverse()[0]
  // 住几晚：出发前一晚 + 已排每一天当晚（最后一天也算 —— 那晚也要落脚）
  const nights = dayCount > 0 ? dayCount + 1 : 0

  return (
    <div className={`${styles.sheet}`}>
      <h1>{plan.name}</h1>
      <div className={`${styles.sub}`}>
        {first?.dateISO && <span>出发日：{first.dateISO}（{first.weekday}）</span>}
        <span>共 {dayCount} 天</span>
        <span>{formatKm(totalKm)} km</span>
        {totalGain !== null && <span>累计爬升 {Math.round(totalGain)} m</span>}
        <span>{nights} 晚住宿</span>
        {lastFn?.dateISO && lastFn.dateISO !== first?.dateISO && <span>至 {lastFn.dateISO}</span>}
      </div>

      {/* 出发前一晚：单独一栏 —— 它不属于任何一天，第二天一早就要从第一天起点开走 */}
      {first && (
        <section className={`${styles.day} ${styles['day-prev']}`}>
          <div className={`${styles['day-h']}`}>
            出发前一晚
            {prevLabel && <span>· {prevLabel}</span>}
          </div>
          <div className={`${styles['day-m']}`}>
            次日从「{first.rows[0].route.startPoint?.name ?? first.rows[0].route.name}」开走
          </div>
          {prevNight ? (
            <div className={`${styles.stay}`}>
              🛏 <b>建议住：{prevNight.area}</b>
              {prevNight.lockedHotel && <span> —— 已定：{prevNight.lockedHotel.name}</span>}
              <div className={`${styles['stay-why']}`}>{prevNight.reason}</div>
              {prevNight.candidates.length > 0 && (
                <div className={`${styles['stay-list']}`}>
                  候选（按离第一天出发点 {STAY_SEARCH_KM} km 内由近及远）：
                  {prevNight.candidates
                    .slice(0, 3)
                    .map((c) => c.hotel.name + (c.hotel.priceRange ? `（${c.hotel.priceRange}）` : ''))
                    .join(' · ')}
                </div>
              )}
            </div>
          ) : (
            <div className={`${styles.stay}`}>🛏 暂无前夜住宿数据可推荐</div>
          )}
          {plan.prevStayNote && (
            <div className={`${styles['day-note']}`}>备注：{plan.prevStayNote}</div>
          )}
        </section>
      )}

      {usedDays.map((d) => {
          const stay = stays.get(d.day) ?? null
          return (
            <section className={`${styles.day}`} key={d.day}>
              <div className={`${styles['day-h']}`}>
                第 {d.day} 天
                {d.dateISO && <span>· {d.dateISO} {d.weekday}</span>}
              </div>
              <div className={`${styles['day-m']}`}>
                {formatKm(d.distanceKm)} km · 约 {formatHours(d.hours)}
                {d.gainM !== null && <> · 累计爬升 {Math.round(d.gainM)} m</>}
                {d.difficultyMax > 0 && <> · 难度 {d.difficultyMax}/5</>}
              </div>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>序</th>
                    <th>路线</th>
                    <th style={{ width: 72 }}>里程</th>
                    <th style={{ width: 64 }}>爬升</th>
                    <th>起点 → 终点</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r, i) => {
                    const ends = routeEnds(r.route, metrics.get(r.route.id))
                    return (
                      <tr key={r.route.id}>
                        <td>{i + 1}</td>
                        <td>
                          偶来 {r.route.code ?? r.route.id} · {r.route.name}
                        </td>
                        <td>{formatKm(r.km)} km</td>
                        <td>{r.gainM == null ? '—' : `↑${Math.round(r.gainM)}m`}</td>
                        <td>
                          {ends.start?.name ?? '—'} → {ends.end?.name ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {d.warnings.map((w, i) => (
                <div className={`${styles['day-warn']}`} key={`${w.kind}-${i}`}>
                  {w.text}
                </div>
              ))}
              {plan.dayNotes?.[d.day] && (
                <div className={`${styles['day-note']}`}>备注：{plan.dayNotes[d.day]}</div>
              )}
              {stay ? (
                <div className={`${styles.stay}`}>
                  🛏 <b>建议住：{stay.area}</b>
                  {d.isLast && <span>（最后一晚）</span>}
                  {stay.lockedHotel && <span> —— 已定：{stay.lockedHotel.name}</span>}
                  <div className={`${styles['stay-why']}`}>{stay.reason}</div>
                  {stay.altArea && (
                    <div className={`${styles['stay-why']}`}>
                      备选：{stay.altArea} —— {stay.altReason}
                    </div>
                  )}
                  {stay.candidates.length > 0 && (
                    <div className={`${styles['stay-list']}`}>
                      候选（按离今晚终点 {STAY_SEARCH_KM} km 内、加权距离排序）：
                      {stay.candidates
                        .slice(0, 3)
                        .map((c) => c.hotel.name + (c.hotel.priceRange ? `（${c.hotel.priceRange}）` : ''))
                        .join(' · ')}
                    </div>
                  )}
                </div>
              ) : (
                <div className={`${styles.stay}`}>🛏 暂无住宿数据可推荐</div>
              )}
            </section>
          )
        })}

      <div className={`${styles.foot}`}>
        里程取自各路线实测/手填口径，耗时为按「平地 3.6 km/h + 每 450 m 爬升折 1 小时」的估算值，
        请以官方建议为准；交通班次请在出发前自行复核。
      </div>
    </div>
  )
}
