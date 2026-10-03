import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createPortal } from 'react-dom'
import type { Hotel } from '../types'
import { STAY_SEARCH_KM } from '../lib/stayMatch'
import { matchStayName } from '../lib/staySearch'
import { stayName } from '../lib/stayName'
import { Markdown } from './Markdown'
import styles from './StayPickerDrawer.module.less'

/**
 * 抽屉里的一行住宿。
 *
 * 距离口径由调用方决定，所以这里不写死「距终点 / 距起点」：
 * - `night`（某天晚上）：主距离是距今晚终点，副距离是距明早起点；
 * - `prev`（出发前一晚）：主距离是距第一天出发点，没有副距离。
 */
export interface StayPickerRow {
  hotel: Hotel
  /** 主距离 km（每晚：距今晚终点；前夜：距明早出发点） */
  distanceKm: number
  /** 副距离 km，没有就是 null（每晚：距明早起点；前夜：null） */
  distance2Km: number | null
  /** 是否在候选半径内（列在「较远」分隔线之前） */
  near: boolean
}

export interface StayPickerDrawerProps {
  /** 口径：'night' = 某天晚上（离终点近优先）；'prev' = 出发前一晚（离第一天出发点近优先） */
  variant: 'night' | 'prev'
  /** 天号（1-based），仅 variant 为 'night' 时用于标题 */
  day?: number
  /** 全量住宿候选（已按对应口径排好序，不做 8 km 截断） */
  rows: StayPickerRow[]
  /** 当前锁定的住宿 id；没有则 undefined */
  lockedId?: string
  /** 选定某家（传 undefined = 取消锁定，回到自动推荐） */
  onPick: (hotelId: string | undefined) => void
  onClose: () => void
}

/**
 * 副文本里的业态要不要再写一遍。
 *
 * 名称显示优先级：中文(nameZh) > 英文(nameEn) > 韩文原名(name)，由 `stayName` 统一处理；
 * 业态由 `note` 单独承载，所以副文本这里照常补业态，整行才看得出是民宿还是汽车旅馆。
 * （后台把 nameZh 手写成带业态的情况仍会去重，不会出现「XX 酒店 · 酒店」。）
 */
function typeSuffix(title: string, note?: string): string {
  if (!note) return ''
  const zh = note.split('/')[0].trim()
  return zh && title.includes(zh) ? '' : ` · ${note}`
}

/**
 * 抽屉里的一行住宿。
 * 名称 / 距离 / 业态 / 价格那行保持紧凑；有「介绍」的酒店多一个就地手风琴：
 * 点「介绍 ▾」在原行下方展开 Markdown 渲染的详细介绍，再点「收起 ▴」收起（不弹窗）。
 * 展开态各自独立（每行一个 open 状态），不影响其它行。
 */
function StayRow({
  c,
  isPrev,
  lockedId,
  onPick,
}: {
  c: StayPickerRow
  isPrev: boolean
  lockedId?: string
  onPick: (hotelId: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const intro = c.hotel.intro
  return (
    <div className={`${styles.row}${lockedId === c.hotel.id ? ` ${styles['is-locked']}` : ''}`}>
      <div className={`${styles['row-main']}`}>
        <div className={`${styles['row-n']}`}>
          {stayName(c.hotel)}
          {lockedId === c.hotel.id && <span className={`${styles['row-lock']}`}>✓ 已锁定</span>}
        </div>
        {c.hotel.name !== stayName(c.hotel) && (
          <div className={`${styles['row-ko']}`}>
            {c.hotel.name}
            {c.hotel.nameEn && c.hotel.nameEn !== c.hotel.name && c.hotel.nameEn !== stayName(c.hotel) && ` · ${c.hotel.nameEn}`}
          </div>
        )}
        <div className={`${styles['row-m']}`}>
          {isPrev ? '距明早出发点' : '距今晚终点'} {c.distanceKm.toFixed(1)} km
          {c.distance2Km !== null && ` · 距明早起点 ${c.distance2Km.toFixed(1)} km`}
          {typeSuffix(stayName(c.hotel), c.hotel.note)}
          {c.hotel.priceRange && ` · ${c.hotel.priceRange}`}
          {typeof c.hotel.rating === 'number' && ` · ★${c.hotel.rating.toFixed(1)}`}
        </div>
        {intro && (
          <button
            className={styles['row-intro-toggle']}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? '收起介绍 ▴' : '介绍 ▾'}
          </button>
        )}
      </div>
      {open && intro && (
        <div className={styles['row-intro']}>
          <Markdown text={intro} />
        </div>
      )}
      <div className={`${styles['row-act']}`}>
        <button
          className={`btn btn-xs${lockedId === c.hotel.id ? '' : ' btn-primary'}`}
          onClick={() => onPick(lockedId === c.hotel.id ? undefined : c.hotel.id)}
        >
          {lockedId === c.hotel.id ? '取消锁定' : '住这家'}
        </button>
      </div>
    </div>
  )
}

/**
 * 行程篮里「查看全部住宿」的抽屉：从右侧滑入的浮层。
 *
 * ## 为什么是抽屉而不是就地展开
 * 一天的候选少则几十、多则两百多家（全岛住宿池是跨路线共享的），
 * 就地铺开会把当天那张 300px 的卡片撑成一根长条，把下面的备注框和「加一天」挤出屏幕。
 * 浮层既装得下长列表，也不打乱看板本身的横向布局。
 *
 * ## 两种口径
 * 每天的「今晚住」和「出发前一晚」权重不同（前者离终点近，后者离第一天出发点近），
 * 但列表、搜索、锁定这些交互是同一套，所以用 `variant` 区分口径文案，不复制一份组件。
 *
 * ## 交互
 * 每行一个「住这家」——点了就锁定这家并关掉抽屉（卡片上立刻显示「✓ 已锁定」）；
 * 已锁定的那行反过来变成「取消锁定」。顶部另有一条锁定条：锁定的那家可能排在很后面，
 * 不用翻列表也能直接取消。
 */
export function StayPickerDrawer({
  variant,
  day,
  rows,
  lockedId,
  onPick,
  onClose,
}: StayPickerDrawerProps) {
  const isPrev = variant === 'prev'
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const t = q.trim()
    if (!t) return rows
    return rows.filter(({ hotel }) => matchStayName(hotel, t))
  }, [rows, q])

  /** Esc 关闭 + 打开期间锁住页面滚动（与详情页住宿抽屉同一套手势） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const locked = lockedId ? rows.find((r) => r.hotel.id === lockedId) : undefined
  const nearCount = rows.filter((r) => r.near).length
  /** 第一条「超出 8 km」的位置：在它前面插一条分隔提示 */
  const farAt = filtered.findIndex((r) => !r.near)

  return createPortal(
    <div
      className={`${styles.mask}`}
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside
        className={`${styles.drawer}`}
        role="dialog"
        aria-modal="true"
        aria-label={isPrev ? '出发前一晚住宿全部列表' : `第 ${day} 天住宿全部列表`}
      >
        <header className={`${styles.head}`}>
          <div className={`${styles.title}`}>
            <b>{isPrev ? '出发前一晚 · 住哪' : `第 ${day} 天 · 今晚住哪`}</b>
            <span className={`${styles.count}`}>
              共 {rows.length} 家{nearCount < rows.length && ` · ${STAY_SEARCH_KM} km 内 ${nearCount} 家`}
            </span>
          </div>
          <button className={`${styles.close}`} onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <div className={`${styles.hint}`}>
          {isPrev
            ? '按「距第一天出发点」排序，和卡片上那几条的口径一致；'
            : '按「0.6 × 距今晚终点 + 0.4 × 距明早起点」排序，和卡片上那几条的口径一致；'}
          {STAY_SEARCH_KM} km 以外的列在后面并标「较远」，仍可点选。
        </div>

        {locked && (
          <div className={`${styles.locked}`}>
            <span>
              当前已锁定：<b>{stayName(locked.hotel)}</b>
            </span>
            <button className="btn btn-xs" onClick={() => onPick(undefined)}>
              取消锁定
            </button>
          </div>
        )}

        <div className={`${styles['search-wrap']}`}>
          <input
            className={`${styles.search}`}
            placeholder="搜索名称（中文 / 韩文 / 英文）"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className={`${styles.body}`}>
          {rows.length === 0 ? (
            <div className={`${styles.empty}`}>
              还没有录入任何住宿 —— 去<Link to="/admin">素材管理</Link>
              给路线补录后，这里会列出全岛住宿并按距离排序。
            </div>
          ) : filtered.length === 0 ? (
            <div className={`${styles.empty}`}>没有匹配的住宿。</div>
          ) : (
            filtered.map((c, i) => (
              <div key={c.hotel.id}>
                {i === farAt && (
                  <div className={`${styles.divider}`}>
                    以下超出 {STAY_SEARCH_KM} km · 较远，仅供参考
                  </div>
                )}
                <StayRow
                  c={c}
                  isPrev={isPrev}
                  lockedId={lockedId}
                  onPick={onPick}
                />
              </div>
            ))
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
