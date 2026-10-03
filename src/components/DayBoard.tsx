import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Hotel } from '../types'
import { formatKm } from '../lib/geo'
import {
  estimateHours,
  formatHours,
  unassignedRows,
  type DayPlan,
  type PlanRow,
} from '../lib/dayPlan'
import {
  rankAllByStart,
  rankAllStays,
  suggestStay,
  type LinkedHotel,
  type PrevStayCandidate,
  type PrevStaySuggestion,
  type StayCandidate,
  type StaySuggestion,
} from '../lib/stayMatch'
import { formatDurationRange, officialDuration } from '../lib/olleDurations'
import { stayName, staySubName } from '../lib/stayName'
import { Select } from './Select'
import { StayPickerDrawer, type StayPickerRow } from './StayPickerDrawer'
import styles from './DayBoard.module.less'

/** 住宿抽屉打开在哪一档：'night' 是第 day 天晚上，'prev' 是出发前一晚 */
type PickerTarget = { kind: 'night'; day: number } | { kind: 'prev' }

/** 每晚候选 → 抽屉行：主距离是距今晚终点，副距离是距明早起点 */
function nightRow(c: StayCandidate): StayPickerRow {
  return { hotel: c.hotel, distanceKm: c.toEndKm, distance2Km: c.toNextStartKm, near: c.near }
}

/** 前夜候选 → 抽屉行：只有「距明早出发点」一个距离 */
function prevRow(c: PrevStayCandidate): StayPickerRow {
  return { hotel: c.hotel, distanceKm: c.toStartKm, distance2Km: null, near: c.near }
}

export interface DayBoardProps {
  rows: PlanRow[]
  /** 天数 + 每天计算结果，由父组件用 planDays() 算好 */
  days: DayPlan[]
  /** 每天的住宿建议，key 为天号 */
  stays: Map<number, StaySuggestion | null>
  /** 全岛住宿池（跨路线收集，按 hotel.id 去重）——「查看全部住宿」抽屉的全量列表来源 */
  hotels: LinkedHotel[]
  /** 「出发前一晚」的住宿建议；没有排任何一天时传 null */
  prevNight: PrevStaySuggestion | null
  /** 出发前一晚对应的日期标签（由父组件算好，没填出发日就是空串） */
  prevLabel?: string
  prevNote: string
  onSetPrevNote: (text: string) => void
  onLockPrevStay: (hotelId: string | undefined) => void
  onAssignDay: (routeId: string, day: number | undefined) => void
  onMoveInDay: (routeId: string, dir: -1 | 1) => void
  onRemove: (routeId: string) => void
  onToggleDone: (routeId: string) => void
  onLockStay: (day: number, hotelId: string | undefined) => void
  onAddDay: () => void
  onRemoveDay: (day: number) => void
  /** 某天的备注（行程单 / Markdown 会带上） */
  noteOfDay: (day: number) => string
  onSetDayNote: (day: number, text: string) => void
}

function stars(level: number): string {
  return '★'.repeat(Math.max(0, Math.min(5, level))) + '☆'.repeat(Math.max(0, 5 - level))
}

/**
 * 按天排期的看板。
 *
 * ## 布局：待安排固定单列 + 天数列横向滚动
 * 「待安排」单独固定在最左侧一列（不参与横向滚动），右侧的「前夜 + 各天」放进一个
 * `overflow-x: auto` 的滚动容器里。
 *
 * 这样两个诉求同时满足：
 * 1. 待安排始终是看得见、够得着的单列（固定列，不会被推走）；
 * 2. 天数再多，天数列也只是横向滚动 —— 拖拽前先把目标那天滚到贴着待安排的位置，
 *    短距离一拖就到位；浏览器原生也会在拖到滚动区边缘时自动续滚，远天也够得着。
 *
 * ## 交互的三条路径
 * 1. **拖拽**（桌面整理大量路线时用）：原生 HTML5 Drag and Drop，**没有引第三方库**。
 * 2. **卡片上的「第几天」下拉**（**主路径**，手机上只能靠它）——原生 select 天然可用。
 * 3. **↑ ↓ 按钮**：同一天内调顺序。
 */
export function DayBoard(props: DayBoardProps) {
  const {
    rows,
    days,
    stays,
    hotels,
    prevNight,
    prevLabel,
    prevNote,
    onSetPrevNote,
    onLockPrevStay,
    onAssignDay,
    onMoveInDay,
    onRemove,
    onToggleDone,
    onLockStay,
    onAddDay,
    onRemoveDay,
    noteOfDay,
    onSetDayNote,
  } = props
  const backlog = useMemo(() => unassignedRows(rows), [rows])
  const firstDay = useMemo(() => days.find((d) => d.rows.length > 0), [days])
  const [dragId, setDragId] = useState<string | null>(null)
  const [overDay, setOverDay] = useState<string | null>(null)
  /** 拖拽期间用 ref 存 id：state 更新会晚于 dragstart 的同步读取 */
  const dragRef = useRef<string | null>(null)
  /** 当前打开的「查看全部住宿」抽屉（null = 没开） */
  const [picker, setPicker] = useState<PickerTarget | null>(null)

  const dayOptions = useMemo(() => days.map((d) => d.day), [days])

  /**
   * 每天的全量住宿候选（抽屉用）：不做 8 km 截断，远近都列。
   * 权重与卡片上的候选一致（0.6 × 今晚终点 + 0.4 × 明早起点），所以抽屉开头的
   * 顺序和卡片里露出的那几条是同一套口径，抽屉只是把后面没露出来的补全。
   */
  const picksByDay = useMemo(() => {
    const map = new Map<number, StayPickerRow[]>()
    days.forEach((d, i) => {
      const lastRoute = d.rows[d.rows.length - 1]?.route
      map.set(
        d.day,
        lastRoute
          ? rankAllStays(lastRoute, days[i + 1]?.rows[0]?.route, hotels).map(nightRow)
          : [],
      )
    })
    return map
  }, [days, hotels])

  /** 出发前一晚的全量住宿候选：同样不截断，按「离第一天出发点近」排 */
  const prevPicks = useMemo(() => {
    const firstRoute = firstDay?.rows[0]?.route
    return firstRoute ? rankAllByStart(firstRoute, hotels).map(prevRow) : []
  }, [firstDay, hotels])

  const handleDrop = (dayKey: string) => {
    const id = dragRef.current ?? dragId
    setOverDay(null)
    setDragId(null)
    dragRef.current = null
    if (!id) return
    onAssignDay(id, dayKey === 'backlog' ? undefined : Number(dayKey))
  }

  const dragProps = (id: string) => ({
    dragging: dragId === id,
    setDrag: (v: string | null) => {
      setDragId(v)
      dragRef.current = v
    },
    clearDrag: () => {
      setDragId(null)
      dragRef.current = null
    },
  })

  return (
    <div className={`${styles.board}`}>
      {/* ① 待安排：固定单列（左），不参与滚动，永远看得见、够得着 */}
      <section
        className={`${styles['strip']} ${styles['col-backlog']}${
          overDay === 'backlog' ? ` ${styles['is-over']}` : ''
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          setOverDay('backlog')
        }}
        onDragLeave={() => setOverDay((v) => (v === 'backlog' ? null : v))}
        onDrop={() => handleDrop('backlog')}
      >
        <div className={`${styles['col-head']}`}>
          <b className={`${styles['col-title']}`}>待安排</b>
          <span className={`${styles['col-date']}`}>还没分天的 {backlog.length} 条</span>
        </div>
        <div className={`${styles['strip-body']}`}>
          {backlog.length === 0 ? (
            <div className={`${styles['col-empty']}`}>都排好了 🎉</div>
          ) : (
            backlog.map((r) => (
              <Card
                key={r.route.id}
                row={r}
                day={undefined}
                dayOptions={dayOptions}
                onAssignDay={onAssignDay}
                onMoveInDay={onMoveInDay}
                onRemove={onRemove}
                onToggleDone={onToggleDone}
                {...dragProps(r.route.id)}
              />
            ))
          )}
        </div>
      </section>

      {/* ② 前夜 + 各天：横向滚动容器，天数再多也能滑到、够得着 */}
      <div className={`${styles['days-scroll']}`}>
        <div className={`${styles.days}`}>
        {firstDay && (
          <section className={`${styles.col} ${styles['col-prev']}`}>
            <div className={`${styles['col-head']}`}>
              <b className={`${styles['col-title']}`}>出发前一晚</b>
              {prevLabel && <span className={`${styles['col-date']}`}>{prevLabel}</span>}
            </div>
            <div className={`${styles['col-line']}`}>
              第一天要从「{firstDay.rows[0].route.startPoint?.name ?? firstDay.rows[0].route.name}」开走
            </div>
            <PrevStayCard
              prev={prevNight}
              picks={prevPicks}
              note={prevNote}
              onSetNote={onSetPrevNote}
              onLock={onLockPrevStay}
              onOpenPicker={() => setPicker({ kind: 'prev' })}
            />
          </section>
        )}

        {days.map((d) => {
          const stay = stays.get(d.day) ?? null
          return (
            <section
              key={d.day}
              className={`${styles.col}${overDay === String(d.day) ? ` ${styles['is-over']}` : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setOverDay(String(d.day))
              }}
              onDragLeave={() => setOverDay((v) => (v === String(d.day) ? null : v))}
              onDrop={() => handleDrop(String(d.day))}
            >
              <div className={`${styles['col-head']}`}>
                <b className={`${styles['col-title']}`}>第 {d.day} 天</b>
                {d.dateLabel && (
                  <span className={`${styles['col-date']}`}>
                    {d.dateLabel} {d.weekday}
                  </span>
                )}
                <span className={`${styles.spacer}`} />
                {days.length > 1 && (
                  <button
                    className="btn btn-xs"
                    onClick={() => onRemoveDay(d.day)}
                    title="删除这天（路线退回待安排）"
                  >
                    删除
                  </button>
                )}
              </div>
              <div className={`${styles['col-stats']}`}>
                <span className="pill">{formatKm(d.distanceKm)} km</span>
                <span className="pill">约 {formatHours(d.hours)}</span>
                {d.gainM !== null && <span className="pill">↑{Math.round(d.gainM)} m</span>}
                {d.difficultyMax > 0 && <span className="pill">{stars(d.difficultyMax)}</span>}
              </div>
              {d.warnings.map((w, idx) => (
                <div
                  key={`${w.kind}-${idx}`}
                  className={`${styles.warn} ${styles[`w-${w.kind}`] ?? styles['w-info']}`}
                >
                  {w.text}
                </div>
              ))}
              <div className={`${styles['col-body']}`}>
                {d.rows.length === 0 ? (
                  <div className={`${styles['col-empty']}`}>把左侧「待安排」的路线拖到这里</div>
                ) : (
                  d.rows.map((r) => (
                    <Card
                      key={r.route.id}
                      row={r}
                      day={d.day}
                      dayOptions={dayOptions}
                      onAssignDay={onAssignDay}
                      onMoveInDay={onMoveInDay}
                      onRemove={onRemove}
                      onToggleDone={onToggleDone}
                      {...dragProps(r.route.id)}
                    />
                  ))
                )}
              </div>
              <StayCard
                day={d}
                stay={stay}
                picks={picksByDay.get(d.day) ?? []}
                onLockStay={onLockStay}
                onOpenPicker={(day) => setPicker({ kind: 'night', day })}
              />
              {/* 当天备注：挂在「天」上、不跟任何偶来小路徒步绑定；没有路线的天（自由活动 / 交通 / 休整）
                  也要能写，所以独立于 StayCard（StayCard 对空天会整块 return null） */}
              <DayNote note={noteOfDay(d.day)} onSetNote={(t) => onSetDayNote(d.day, t)} />
            </section>
          )
        })}

        <section className={`${styles.col} ${styles['col-add']}`}>
          <button className="btn" onClick={onAddDay}>
            + 加一天
          </button>
        </section>
        </div>
      </div>

      {/*
        住宿抽屉：整块看板共用一个实例，开哪一档由 picker 决定。
        「每晚」和「前夜」只是排序口径不同（离终点 / 离第一天出发点），
        列表、搜索、锁定这些交互完全一样，所以复用同一个组件。
      */}
      {picker?.kind === 'night' && (
        <StayPickerDrawer
          variant="night"
          day={picker.day}
          rows={picksByDay.get(picker.day) ?? []}
          lockedId={stays.get(picker.day)?.lockedHotel?.id}
          onPick={(hotelId) => {
            onLockStay(picker.day, hotelId)
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === 'prev' && (
        <StayPickerDrawer
          variant="prev"
          rows={prevPicks}
          lockedId={prevNight?.lockedHotel?.id}
          onPick={(hotelId) => {
            onLockPrevStay(hotelId)
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}

interface CardProps {
  row: PlanRow
  day: number | undefined
  dayOptions: number[]
  dragging: boolean
  onAssignDay: (routeId: string, day: number | undefined) => void
  onMoveInDay: (routeId: string, dir: -1 | 1) => void
  onRemove: (routeId: string) => void
  onToggleDone: (routeId: string) => void
  setDrag: (id: string | null) => void
  clearDrag: () => void
}

function Card(p: CardProps) {
  const { row, day } = p
  const isIsland = (row.route.tags ?? []).includes('离岛') || (row.route.region ?? '').includes('离岛')
  return (
    <article
      className={`${styles.card}${p.dragging ? ` ${styles['is-dragging']}` : ''}`}
      draggable
      onDragStart={() => p.setDrag(row.route.id)}
      onDragEnd={p.clearDrag}
    >
      <div className={`${styles['card-top']}`}>
        <input
          type="checkbox"
          checked={row.done}
          onChange={() => p.onToggleDone(row.route.id)}
          aria-label={`标记 ${row.route.name} 已走完`}
        />
        <span className={`${styles['card-code']}`}>{row.route.code ?? '—'}</span>
        <Link to={`/routes/${row.route.id}`} className={`${styles['card-name']}`}>
          {row.route.name}
        </Link>
        {isIsland && <span className={`${styles.tag} ${styles['tag-island']}`}>离岛</span>}
      </div>
      <div className={`${styles['card-meta']}`}>
        <b>{formatKm(row.km)} km</b>
        <span>↑{row.gainM == null ? '—' : Math.round(row.gainM)} m</span>
        {/* 官方口径优先：录了官方耗时就不再显示公式估算值 */}
        <span>
          {officialDuration(row.route.code)
            ? `${formatDurationRange(officialDuration(row.route.code)!)}（官方）`
            : `约 ${formatHours(estimateHours(row.km, row.gainM))}`}
        </span>
      </div>
      <div className={`${styles['card-act']}`}>
        <Select
          size="xs"
          value={day != null ? String(day) : ''}
          onChange={(v) => p.onAssignDay(row.route.id, v === '' ? undefined : Number(v))}
          options={[
            { value: '', label: '待安排' },
            ...p.dayOptions.map((d) => ({ value: String(d), label: `第 ${d} 天` })),
          ]}
          ariaLabel={`选择 ${row.route.name} 排在第几天`}
          style={{ flex: '1 1 0', minWidth: 0 }}
        />
        <button
          className="btn btn-xs"
          disabled={day === undefined}
          onClick={() => p.onMoveInDay(row.route.id, -1)}
          aria-label="在当天里上移"
        >
          ↑
        </button>
        <button
          className="btn btn-xs"
          disabled={day === undefined}
          onClick={() => p.onMoveInDay(row.route.id, 1)}
          aria-label="在当天里下移"
        >
          ↓
        </button>
        <button className="btn btn-xs" onClick={() => p.onRemove(row.route.id)}>
          移除
        </button>
      </div>
    </article>
  )
}

/**
 * 当天备注：挂在「天」上、不跟任何偶来小路徒步绑定。
 * 放在 StayCard 之外，是因为 StayCard 对「没有路线的天」会整块 return null ——
 * 而自由活动日 / 交通日 / 休整日恰恰是没有徒步的那天，反而最需要写备注。
 */
function DayNote({
  note,
  onSetNote,
}: {
  note: string
  onSetNote: (text: string) => void
}) {
  return (
    <label className={`${styles['note-field']}`}>
      <span className={`${styles['stay-label']}`}>✏️ 当天备注</span>
      <input
        className="input input-xs"
        value={note}
        placeholder="今天的安排、订房确认号、接驳安排……会印进行程单"
        onChange={(e) => onSetNote(e.target.value)}
      />
    </label>
  )
}

interface StayCardProps {
  day: DayPlan
  stay: StaySuggestion | null
  /** 这一天的全量住宿候选（抽屉用，已按距离权重排好序） */
  picks: StayPickerRow[]
  onLockStay: (day: number, hotelId: string | undefined) => void
  /** 打开「查看全部住宿」抽屉 */
  onOpenPicker: (day: number) => void
}

function StayCard({ day, stay, picks, onLockStay, onOpenPicker }: StayCardProps) {
  if (day.rows.length === 0) return null
  const headExtra = day.isLast ? <span className={`${styles['stay-tag']}`}>最后一晚</span> : null

  if (!stay) {
    return (
      <div className={`${styles.stay} ${styles['stay-empty']}`}>
        <div className={`${styles['stay-head']}`}>
          <span className={`${styles['stay-label']}`}>🛏 今晚住</span>
          {headExtra}
        </div>
        <div className={`${styles['stay-reason']}`}>
          这条路线没有任何住宿数据可推：既没有官方的住宿建议口径，也没录入过附近的住宿。
          去<Link to="/admin">素材管理</Link>给路线补录住宿后，这里会自动出候选清单。
        </div>
      </div>
    )
  }
  /**
   * 卡片上陈列的候选：默认前 5 条。
   * 锁定的那家若在 8 km 以外（不在自动候选里）就顶到第一位 —— 从抽屉里挑了远处的住宿，
   * 卡片上却看不见它，会让人以为没选上。
   */
  const top5 = stay.candidates.slice(0, 5)
  const lockedPick = stay.lockedHotel
    ? picks.find((p) => p.hotel.id === stay.lockedHotel?.id)
    : undefined
  const shown =
    lockedPick && !top5.some((c) => c.hotel.id === lockedPick.hotel.id)
      ? [lockedPick, ...top5.slice(0, 4).map(nightRow)]
      : top5.map(nightRow)

  return (
    <div className={`${styles.stay}`}>
      <div className={`${styles['stay-head']}`}>
        <span className={`${styles['stay-label']}`}>🛏 今晚住</span>
        <b className={`${styles['stay-area']}`}>{stay.area}</b>
        {/* 区域建议照旧是系统推的那条，订了哪家在这里补一句 —— 与行程单同一口径 */}
        {stay.lockedHotel && (
          <span className={`${styles['stay-locked']}`}>
            已定：{stayName(stay.lockedHotel)}
          </span>
        )}
        {headExtra}
        {stay.lockedHotel && (
          <button className="btn btn-xs" onClick={() => onLockStay(day.day, undefined)}>
            取消锁定
          </button>
        )}
      </div>
      <div className={`${styles['stay-reason']}`}>推荐理由：{stay.reason}</div>
      {stay.altArea && (
        <div className={`${styles['stay-alt']}`}>
          备选：{stay.altArea} —— {stay.altReason}
        </div>
      )}
      {shown.length > 0 ? (
        <div className={`${styles['stay-opts']}`}>
          {shown.map((c) => (
            <StayOption
              key={c.hotel.id}
              hotel={c.hotel}
              meta={`距今晚终点 ${c.distanceKm.toFixed(1)} km${
                c.distance2Km !== null ? ` · 距明早起点 ${c.distance2Km.toFixed(1)} km` : ''
              }`}
              locked={stay.lockedHotel?.id === c.hotel.id}
              onLock={(v) => onLockStay(day.day, v)}
            />
          ))}
        </div>
      ) : (
        <div className={`${styles['stay-nodata']}`}>
          附近 8 km 内没有已录入的住宿 ——
          <Link to="/admin">去素材管理补录</Link>后，这里会自动列出候选并按距离排序。
          在此之前，上面那条区域建议就是全部可用信息。
        </div>
      )}
      {/* 卡片上只陈列前 5 条；全量（含 8 km 以外的）在抽屉里翻，避免把当天这列撑成一根长条 */}
      {picks.length > 0 && (
        <button className={`${styles['stay-more']}`} onClick={() => onOpenPicker(day.day)}>
          查看全部住宿（{picks.length} 家）
          <span className={`${styles['stay-more-arrow']}`} aria-hidden>
            ›
          </span>
        </button>
      )}
    </div>
  )
}

interface PrevStayCardProps {
  prev: PrevStaySuggestion | null
  /** 前夜的全量住宿候选（抽屉用，按离第一天出发点近排序） */
  picks: StayPickerRow[]
  note: string
  onSetNote: (text: string) => void
  onLock: (hotelId: string | undefined) => void
  /** 打开「查看全部住宿」抽屉 */
  onOpenPicker: () => void
}

/** 「出发前一晚」的住宿卡 —— 权重是离第一天出发点近，不是离终点近 */
function PrevStayCard({ prev, picks, note, onSetNote, onLock, onOpenPicker }: PrevStayCardProps) {
  const noteField = (
    <label className={`${styles['note-field']}`}>
      <span className={`${styles['stay-label']}`}>✏️ 备注</span>
      <input
        className="input input-xs"
        value={note}
        placeholder="航班号、接机安排……会印进行程单"
        onChange={(e) => onSetNote(e.target.value)}
      />
    </label>
  )

  if (!prev) {
    return (
      <div className={`${styles.stay} ${styles['stay-empty']}`}>
        <div className={`${styles['stay-head']}`}>
          <span className={`${styles['stay-label']}`}>🛏 前一晚住</span>
        </div>
        <div className={`${styles['stay-reason']}`}>
          第一天那条路线没有官方的前夜住宿建议，也推不出所在区域 ——
          去<Link to="/admin">素材管理</Link>补录住宿后这里会自动出候选。
        </div>
        {/* 推不出区域不代表没得住：起点附近录过住宿的话，仍然可以从抽屉里挑一家 */}
        {picks.length > 0 && (
          <button className={`${styles['stay-more']}`} onClick={onOpenPicker}>
            查看全部住宿（{picks.length} 家）
            <span className={`${styles['stay-more-arrow']}`} aria-hidden>
              ›
            </span>
          </button>
        )}
        {noteField}
      </div>
    )
  }

  /**
   * 卡片上陈列的候选：默认前 5 条。
   * 锁定的那家若在 8 km 以外（不在自动候选里）就顶到第一位 —— 从抽屉里挑了远处的住宿，
   * 卡片上却看不见它，会让人以为没选上。
   */
  const top5 = prev.candidates.slice(0, 5)
  const lockedPick = prev.lockedHotel
    ? picks.find((p) => p.hotel.id === prev.lockedHotel?.id)
    : undefined
  const shown =
    lockedPick && !top5.some((c) => c.hotel.id === lockedPick.hotel.id)
      ? [lockedPick, ...top5.slice(0, 4).map(prevRow)]
      : top5.map(prevRow)

  return (
    <div className={`${styles.stay}`}>
      <div className={`${styles['stay-head']}`}>
        <span className={`${styles['stay-label']}`}>🛏 前一晚住</span>
        <b className={`${styles['stay-area']}`}>{prev.area}</b>
        {/* 同上：区域建议照旧，订了哪家补在后面 */}
        {prev.lockedHotel && (
          <span className={`${styles['stay-locked']}`}>
            已定：{stayName(prev.lockedHotel)}
          </span>
        )}
        {prev.lockedHotel && (
          <button className="btn btn-xs" onClick={() => onLock(undefined)}>
            取消锁定
          </button>
        )}
      </div>
      <div className={`${styles['stay-reason']}`}>推荐理由：{prev.reason}</div>
      {shown.length > 0 ? (
        <div className={`${styles['stay-opts']}`}>
          {shown.map((c) => (
            <StayOption
              key={c.hotel.id}
              hotel={c.hotel}
              meta={`距明早出发点 ${c.distanceKm.toFixed(1)} km`}
              locked={prev.lockedHotel?.id === c.hotel.id}
              onLock={(v) => onLock(v)}
            />
          ))}
        </div>
      ) : (
        <div className={`${styles['stay-nodata']}`}>
          出发点附近 8 km 内没有已录入的住宿 —— 上面那条区域建议就是全部可用信息。
        </div>
      )}
      {/* 卡片上只陈列前 5 条；全量（含 8 km 以外的）在抽屉里翻 */}
      {picks.length > 0 && (
        <button className={`${styles['stay-more']}`} onClick={onOpenPicker}>
          查看全部住宿（{picks.length} 家）
          <span className={`${styles['stay-more-arrow']}`} aria-hidden>
            ›
          </span>
        </button>
      )}
      {noteField}
    </div>
  )
}

function StayOption({
  hotel,
  meta,
  locked,
  onLock,
}: {
  hotel: Hotel
  meta: string
  locked: boolean
  onLock: (hotelId: string | undefined) => void
}) {
  return (
    <div className={`${styles.opt}${locked ? ` ${styles['is-locked']}` : ''}`}>
      <div className={`${styles['opt-n']}`}>
        {stayName(hotel)}
        {staySubName(hotel) && (
          <span
            className={`${styles['opt-ko']}`}
            title={[hotel.nameEn, hotel.nameRomaja].filter(Boolean).join(' · ') || hotel.name}
          >
            {hotel.name}
          </span>
        )}
        {locked && <span className={`${styles['opt-lock']}`}>✓ 已锁定</span>}
      </div>
      <div className={`${styles['opt-m']}`}>
        {meta}
        {hotel.priceRange && <> · {hotel.priceRange}</>}
        {typeof hotel.rating === 'number' && <> · ★{hotel.rating.toFixed(1)}</>}
      </div>
      <div className={`${styles['opt-act']}`}>
        <button className="btn btn-xs" onClick={() => onLock(locked ? undefined : hotel.id)}>
          {locked ? '取消锁定' : '住这家'}
        </button>
      </div>
    </div>
  )
}

/** 导出给 PlanPage 用的辅助：算出所有天的住宿建议 */
export function buildStays(
  days: DayPlan[],
  items: import('../types').PlanItem[],
  hotels: import('../lib/stayMatch').LinkedHotel[],
): Map<number, StaySuggestion | null> {
  const map = new Map<number, StaySuggestion | null>()
  days.forEach((d, i) => {
    map.set(d.day, suggestStay(d, days[i + 1], hotels, items))
  })
  return map
}
