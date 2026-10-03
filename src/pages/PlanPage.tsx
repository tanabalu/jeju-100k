import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toBlob } from 'html-to-image'
import { useData } from '../store/DataContext'
import { computeMetrics, formatKm, mapLineSet, routeBadgeAnchor } from '../lib/geo'
import { useActivePlan } from '../hooks/useActivePlan'
import { useConfirm, useToast } from '../components/Feedback'
import { Modal } from '../components/Modal'
import { RouteMap } from '../components/RouteMap'
import { DayBoard, buildStays } from '../components/DayBoard'
import { Select } from '../components/Select'
import { DatePicker } from '../components/DatePicker'
import { PlanPrintSheet } from '../components/PlanPrintSheet'
import { PlanHelpSheet } from '../components/PlanHelpSheet'
import { collectHotels, suggestPrevNight } from '../lib/stayMatch'
import { stayName } from '../lib/stayName'
import type { PlanMapStayMode } from '../lib/storage'
import type { Hotel } from '../types'
import {
  DAY_HOURS_LIMIT,
  DAY_KM_LIMIT,
  dayDate,
  planDayNumbers,
  planDays,
  planRows,
  unassignedRows,
} from '../lib/dayPlan'
import { OLLE_TOTAL_KM } from '../lib/seed'
import { useIsMobile } from '../hooks/useIsMobile'
import styles from './PlanPage.module.less'

type PlanSort = 'added' | 'km'
/** 只有「清单 / 按天」两个页签；地图是常驻区块，不参与切换 */
type PlanView = 'list' | 'days'

const VIEWS: { key: PlanView; label: string }[] = [
  { key: 'list', label: '清单' },
  { key: 'days', label: '按天' },
]

/** 行程位置地图的三种查看模式：住宿标画到什么程度 */
const MAP_STAY_MODES: { key: PlanMapStayMode; label: string; hint: string }[] = [
  { key: 'none', label: '仅路径', hint: '只画路线与编号，整图不出现住宿标' },
  { key: 'all', label: '全量住宿', hint: '画出行程篮里每条路线挂着的所有住宿（一次十几个）' },
  { key: 'confirmed', label: '已确认住宿', hint: '只画你在「按天」里点「住这家」锁定下来的住宿，含出发前一晚' },
]

/** 记住用户上次停在哪个页签：刷新 / 重进都恢复；缓存里的值不合法则回落到第一个页签 */
const PLAN_VIEW_KEY = 'jejuolle100k.plan-view'
function readPlanView(): PlanView {
  if (typeof localStorage === 'undefined') return VIEWS[0].key
  const v = localStorage.getItem(PLAN_VIEW_KEY)
  return VIEWS.some((x) => x.key === v) ? (v as PlanView) : VIEWS[0].key
}
function writePlanView(v: PlanView) {
  try {
    localStorage.setItem(PLAN_VIEW_KEY, v)
  } catch {
    /* 隐私模式 / 配额满了：忽略，反正只是个视图偏好 */
  }
}

export function PlanPage() {
  const { routes, ui, updateUi } = useData()
  const planApi = useActivePlan()
  const {
    plan,
    plans,
    addRoute,
    removeRoute,
    toggleDone,
    setTarget,
    rename,
    clear,
    createPlan,
    removePlan,
    selectPlan,
    assignDay,
    moveInDay,
    setStartDate,
    setPrevStay,
    setPrevStayNote,
    setDayNote,
    lockStay,
    addDay,
    removeDay,
  } = planApi
  const toast = useToast()
  const confirm = useConfirm()
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTarget, setNewTarget] = useState(100)
  const [exportOpen, setExportOpen] = useState(false)
  /** 导出弹窗里行程单 DOM 的容器：移动端「保存为图片」时拿它来截图 */
  const sheetRef = useRef<HTMLDivElement>(null)
  /** 是否移动端视图：决定 footer 是竖排按钮 + 图片保存，还是横排 + 打印/PDF */
  const isMobile = useIsMobile()
  /** 生成图片进行中：禁用按钮，防止连点 */
  const [saving, setSaving] = useState(false)
  /** 打印 / 存图时是否附带「备用信息页」（紧急电话 + 中韩求助用语），默认不附 */
  const [withHelp, setWithHelp] = useState(false)
  /** 默认进「清单」视图 —— 老用户的习惯不能被改掉；但若本地缓存过上次选的页签则沿用 */
  const [view, setView] = useState<PlanView>(readPlanView)
  const changeView = (v: PlanView) => {
    setView(v)
    writePlanView(v)
  }
  /** 默认按加入行程篮的先后顺序排（也就是你打算走的次序） */
  const [sort, setSort] = useState<PlanSort>('added')
  /** 只看未完成：隐藏已勾选走完的路线。状态存在本机缓存（jejuolle100k.ui），刷新后仍然保持 */
  const hideDone = ui.planHideDone
  const setHideDone = (v: boolean) => updateUi({ planHideDone: v })
  /**
   * 行程位置地图的住宿模式：只画路径 / 路径+全量住宿 / 路径+已确认住宿。
   * 默认 `all`（与改造前「显示住宿」默认勾选的行为一致），存本机缓存。
   */
  const stayMode = ui.planMapStayMode
  const setStayMode = (v: PlanMapStayMode) => updateUi({ planMapStayMode: v })

  const metrics = useMemo(() => new Map(routes.map((r) => [r.id, computeMetrics(r)])), [routes])
  /** 住宿候选池：跨全部路线收集，由 hotel.id 去重 */
  const hotels = useMemo(() => collectHotels(routes), [routes])

  const dayRows = useMemo(() => planRows(plan, routes, metrics), [plan, routes, metrics])
  const days = useMemo(() => planDays(plan, dayRows, metrics), [plan, dayRows, metrics])
  const stays = useMemo(() => buildStays(days, plan?.items ?? [], hotels), [days, plan, hotels])
  const backlog = useMemo(() => unassignedRows(dayRows), [dayRows])
  const firstDay = useMemo(() => days.find((d) => d.rows.length > 0), [days])
  /** 「出发前一晚」的住宿建议：依据第一天那条的官方「前一晚住哪」口径 + 离第一天起点的距离 */
  const prevNight = useMemo(
    () => suggestPrevNight(firstDay, hotels, plan?.prevStayId),
    [firstDay, hotels, plan],
  )
  /**
   * 前夜的日期 = 出发日减一天。`dayDate(start, 0)` 正好算出这个：
   * 它内部是 `start + (day - 1)`，第 1 天是出发日，第 0 天自然就是出发日前一晚。
   */
  const prevLabel = useMemo(() => {
    const d = dayDate(plan?.startDate, 0)
    return d ? `${d.label} ${d.weekday}` : ''
  }, [plan?.startDate])

  /** 清单视图里可以改排序；排序不影响「按天」视图（那边始终按加入顺序 + 天号） */
  const rows = useMemo(
    () => (sort === 'km' ? [...dayRows].sort((a, b) => b.km - a.km) : dayRows),
    [dayRows, sort],
  )

  /** 勾选过滤只影响展示，不改变合计与复制结果 */
  const visibleRows = hideDone ? rows.filter((r) => !r.done) : rows

  /** 已加入行程篮的各段路线坐标，合并后一次性展示在地图上 */
  const planTrails = useMemo(
    () => rows.map((r) => r.route.points).filter((pts) => pts && pts.length > 0),
    [rows],
  )
  /**
   * 画线几何：每条路线恰好一段 —— 有真实轨迹走轨迹，没有就把途经点连起来。
   * ⚠️ 别只把有轨迹的那几条塞进去：`lines` 一旦非空就整体接管画线，
   * 没轨迹的路线会整条从图上消失（这正是 mapLines 存在的原因）。
   *
   * 同时把「这段是不是示意线」一并传下去：OSM 里 17 / 21 / 18-1 / 18-2 等**没有轨迹**，
   * 图上只能把 seed.ts 的城镇级近似坐标连成直线 —— 不标出来的话，「西海岸一根斜穿
   * 岛内的直线」看起来就跟真走过的路一样。虚线 + 灰绿一眼可辨。
   */
  const planLineSet = useMemo(() => mapLineSet(rows.map((r) => r.route)), [rows])
  const planLines = useMemo(() => planLineSet.map((l) => l.seg), [planLineSet])
  const planApprox = useMemo(() => planLineSet.map((l) => l.approx), [planLineSet])
  /**
   * 标记改用路线编号（而不是起 / 终）：几条线同屏时，
   * 两组起终标记根本分不出哪条是几号，编号徽标一眼就能对上列表。
   */
  const planBadges = useMemo(
    () =>
      rows
        .map((r) => {
          const anchor = routeBadgeAnchor(r.route)
          if (!anchor) return null
          const label = r.route.code || r.route.name
          return { lng: anchor.lng, lat: anchor.lat, label, title: r.route.name }
        })
        .filter((b): b is { lng: number; lat: number; label: string; title: string } => !!b),
    [rows],
  )
  const planHotels = useMemo(() => rows.flatMap((r) => r.route.hotels ?? []), [rows])
  const planSights = useMemo(() => rows.flatMap((r) => r.route.sights ?? []), [rows])

  /**
   * 「已确认住宿」：在「按天」里点「住这家」锁定下来的那些，出发前一晚也算一晚。
   * 只认 `lockedHotel` —— 没锁定的那些是系统推荐，不算确认过。
   * 按「前夜 → 第 1 天 → 第 2 天…」的顺序排，跟行程单上的顺序一致。
   */
  const confirmedHotels = useMemo(() => {
    const out: Hotel[] = []
    const seen = new Set<string>()
    const push = (h: Hotel | undefined) => {
      if (h && !seen.has(h.id)) {
        seen.add(h.id)
        out.push(h)
      }
    }
    push(prevNight?.lockedHotel)
    days.forEach((d) => push(stays.get(d.day)?.lockedHotel))
    return out
  }, [prevNight, days, stays])

  /**
   * 已确认住宿画在紫标上的短标签：`hotel.id` → 「前夜」「第2天」「第1-2天」「第1、3天」。
   *
   * ⚠️ 只有**天号紧挨着**才算连住、才能并成区间。第 1 天和第 3 天住同一家、
   * 中间那晚没定（或住了别家）时，必须写成「第1、3天」：
   * 并成「第1-3天」等于凭空多出第 2 天那一晚，标签直接对不上行程单。
   *
   * 天序用 `day = 0` 表示出发前一晚，排在第一天之前。
   */
  const confirmedBadges = useMemo(() => {
    /** 每家住宿都定在哪些晚（升序；0 = 出发前一晚） */
    const nights = new Map<string, number[]>()
    const add = (h: Hotel | undefined, day: number) => {
      if (!h) return
      const list = nights.get(h.id)
      if (list) list.push(day)
      else nights.set(h.id, [day])
    }
    add(prevNight?.lockedHotel, 0)
    days.forEach((d) => add(stays.get(d.day)?.lockedHotel, d.day))

    /** 一段连住 → 文本；前夜只能出现在段首，且不与「第 N 天」共用一个「第…天」壳 */
    const segText = ([from, to]: [number, number]) => {
      if (from === 0) return to === 0 ? '前夜' : `前夜-第${to}天`
      return from === to ? `第${from}天` : `第${from}-${to}天`
    }

    const out: Record<string, string> = {}
    nights.forEach((list, id) => {
      // 按「天号 +1」切连续段 —— 只看数组相邻项同 id 是不够的，中间那一晚可能压根没定住宿
      const segs: [number, number][] = []
      list.forEach((day) => {
        const last = segs[segs.length - 1]
        if (last && day === last[1] + 1) last[1] = day
        else segs.push([day, day])
      })
      // 段数多到写不下就截断：药丸宽度随字数涨，全列出来会把地图糊住
      const shown = segs.slice(0, 3)
      out[id] = shown.map(segText).join('、') + (segs.length > shown.length ? '、…' : '')
    })
    return out
  }, [prevNight, days, stays])

  /** 已确认住宿标悬停时补的一行小字：把短标签摊开说清楚，读得懂是哪一晚定下的 */
  const confirmedNotes = useMemo(() => {
    const map: Record<string, string> = {}
    Object.entries(confirmedBadges).forEach(([id, label]) => {
      map[id] = `${label} · 已确认`
    })
    return map
  }, [confirmedBadges])

  /**
   * 地图上实际要画的住宿：由当前模式决定。
   * 只有「已确认」模式才带标签与小字 —— 全量住宿十几家都写「第 N 天」没有意义（它们还没被选过）。
   */
  const mapHotels = stayMode === 'all' ? planHotels : stayMode === 'confirmed' ? confirmedHotels : []
  const mapHotelBadges = stayMode === 'confirmed' ? confirmedBadges : undefined
  const mapHotelNotes = stayMode === 'confirmed' ? confirmedNotes : undefined

  const total = rows.reduce((s, r) => s + r.km, 0)
  const target = plan?.targetKm ?? 100
  const gap = target - total
  const done = total >= target
  const pct = Math.min(100, (total / Math.max(target, 1)) * 100)

  /** 走完进度：按条数 + 已走里程 */
  const doneCount = rows.filter((r) => r.done).length
  const totalCount = rows.length
  const doneKm = rows.filter((r) => r.done).reduce((s, r) => s + r.km, 0)
  const donePct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0
  const allDone = totalCount > 0 && doneCount === totalCount

  /** 按天视图的汇总 */
  const usedDays = useMemo(() => days.filter((d) => d.rows.length > 0), [days])
  /** 住几晚 = 出发前一晚 + 已排每一天当晚（最后一天同样算一晚 —— 那晚也要落脚） */
  const nights = usedDays.length > 0 ? usedDays.length + 1 : 0
  const overloaded = useMemo(
    () =>
      days
        .filter((d) => d.rows.length > 0 && (d.distanceKm > DAY_KM_LIMIT || d.hours > DAY_HOURS_LIMIT))
        .map((d) => d.day),
    [days],
  )

  const suggestions = useMemo(() => {
    if (done) return []
    const inPlan = new Set(plan?.items.map((i) => i.routeId) ?? [])
    return routes
      .filter((r) => !inPlan.has(r.id))
      .map((r) => ({ route: r, km: metrics.get(r.id)?.distanceKm ?? 0 }))
      .filter((x) => x.km > 0)
      .sort((a, b) => Math.abs(a.km - gap) - Math.abs(b.km - gap))
      .slice(0, 4)
  }, [done, plan, routes, metrics, gap])

  /**
   * Markdown 行程单：分过天的按天分组输出，**没分天时退回原来的平铺表格** ——
   * 「什么都没排」时复制出来的内容必须和以前一模一样。
   */
  const buildMarkdown = () => {
    if (!plan) return ''
    const used = days.filter((d) => d.rows.length > 0)
    const lines = [
      `# ${plan.name}`,
      '',
      `- 目标里程：${target} km`,
      `- 当前合计：**${formatKm(total)} km** ${done ? '✅ 已达标' : `（还差 ${formatKm(gap)} km）`}`,
    ]
    if (plan.startDate && used.length) lines.push(`- 出发日：${plan.startDate}`)
    if (used.length) {
      lines.push(`- 天数：${used.length} 天`)
      lines.push(
        `- 住宿：${nights} 晚（出发前一晚 + 每一天当晚${
          used.length > 1 ? '，含最后一天' : ''
        }）`,
      )
    } else {
      lines.push(`- 排序：${sort === 'added' ? '按加入顺序' : '按里程排序'}`)
    }
    lines.push('')

    if (!used.length) {
      lines.push('| 序 | 路线 | 里程 | 完成 |', '| --- | --- | --- | --- |')
      rows.forEach((r, i) => {
        lines.push(`| ${i + 1} | ${r.route.name} | ${formatKm(r.km)} | ${r.done ? '✅' : ''} |`)
      })
      return lines.join('\n')
    }

    /* 出发前一晚：不归任何一天，单独一节放在最前面 */
    if (firstDay) {
      const head = prevLabel ? ` · ${prevLabel}` : ''
      lines.push(`## 出发前一晚${head}`, '')
      lines.push(
        `次日要从「${firstDay.rows[0].route.startPoint?.name ?? firstDay.rows[0].route.name}」开走。`,
        '',
      )
      if (prevNight) {
        const locked = prevNight.lockedHotel ? ` —— 已定：${stayName(prevNight.lockedHotel)}` : ''
        lines.push(`🛏 建议住：**${prevNight.area}**${locked}`, '', `> ${prevNight.reason}`)
        lines.push('')
      } else {
        lines.push('🛏 暂无前夜住宿数据可推荐', '')
      }
      if (plan.prevStayNote) lines.push(`备注：${plan.prevStayNote}`, '')
    }

    used.forEach((d) => {
      const tail = d.dateISO ? ` · ${d.dateISO} ${d.weekday ?? ''}`.trimEnd() : ''
      lines.push(`## 第 ${d.day} 天${tail} · ${formatKm(d.distanceKm)} km`, '')
      lines.push('| 序 | 路线 | 里程 | 起点 → 终点 |', '| --- | --- | --- | --- |')
      d.rows.forEach((r, i) => {
        const pts = r.route.points ?? []
        const from = pts[0]?.name ?? '—'
        const to = pts[pts.length - 1]?.name ?? '—'
        lines.push(`| ${i + 1} | ${r.route.name} | ${formatKm(r.km)} | ${from} → ${to} |`)
      })
      lines.push('')
      const stay = stays.get(d.day) ?? null
      if (stay) {
        const locked = stay.lockedHotel ? ` —— 已定：${stayName(stay.lockedHotel)}` : ''
        lines.push(
          `🛏 建议住：**${stay.area}**${d.isLast ? '（最后一晚）' : ''}${locked}`,
          '',
          `> ${stay.reason}`,
        )
        if (stay.altArea) lines.push(`> 备选：${stay.altArea} —— ${stay.altReason ?? ''}`)
        lines.push('')
      } else {
        lines.push('🛏 暂无住宿数据可推荐', '')
      }
      const note = plan.dayNotes?.[d.day]
      if (note) lines.push(`备注：${note}`, '')
    })
    return lines.join('\n')
  }

  const copyMarkdown = async () => {
    if (!plan) return
    try {
      await navigator.clipboard.writeText(buildMarkdown())
      toast('已复制为 Markdown', 'success')
    } catch {
      toast('复制失败，请手动选择文本', 'error')
    }
  }

  /**
   * 移动端版「保存行程单」：浏览器在手机上唤不起 PDF 保存的系统弹窗，
   * 所以改成把行程单渲染成图片，再走系统分享面板存到相册。
   *
   * 截图用 html-to-image —— 行程单是纯文本 + 系统字体、没有任何外链图片/字体，
   * 正好避开了这个库最容易踩的「跨域图片 / 中文字体缺失」两个坑。
   *
   * 存图路径优先级：
   * 1. 系统分享（navigator.share + files）—— iOS / Android 的分享面板里能直接「存储到照片 / 保存到相册」；
   * 2. 分享不支持或被取消 → 兜底下载到本机（Android 进「下载内容」，iOS 可长按预览图保存）。
   */
  const saveAsImage = async () => {
    const node = sheetRef.current
    if (!node || saving) return
    setSaving(true)
    try {
      const blob = await toBlob(node, {
        pixelRatio: 2,
        skipFonts: true,
        backgroundColor: '#ffffff',
        cacheBust: true,
      })
      if (!blob) {
        toast('生成图片失败', 'error')
        return
      }
      const fileName = `${plan?.name || '行程单'}.png`
      const file = new File([blob], fileName, { type: 'image/png' })

      if (
        typeof navigator !== 'undefined' &&
        navigator.canShare &&
        navigator.canShare({ files: [file] })
      ) {
        try {
          await navigator.share({
            files: [file],
            title: plan?.name || '行程单',
            text: '济州偶来百公里行程单',
          })
          return
        } catch (err) {
          // 用户主动取消分享（AbortError）属于正常操作，不再兜底下载
          if ((err as DOMException)?.name === 'AbortError') return
        }
      }

      // 兜底：触发本机下载
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast('已生成图片，请在下载中查看（或长按保存）', 'success')
    } catch (err) {
      console.error('[export] 生成行程单图片失败', err)
      toast('生成图片失败，请重试', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className={`${styles['plan-head']}`}>
        <div>
          <h1 className="detail-title">行程篮 · 自动算百公里</h1>
          <p className="muted">把想走的路线加进来，实时累计里程；切到「按天」排每天走哪几条，会自动推荐当晚住哪。</p>
        </div>
        <div className={`${styles['plan-head-actions']}`}>
          <Select
            value={plan?.id ?? ''}
            onChange={(v) => selectPlan(v)}
            options={[
              ...(plans.length === 0 ? [{ value: '', label: '（暂无行程篮）' }] : []),
              ...plans.map((p) => ({ value: p.id, label: p.name })),
            ]}
            ariaLabel="切换行程篮"
          />
          <button
            className="btn btn-primary"
            onClick={() => {
              setNewName(`行程 ${plans.length + 1}`)
              setNewTarget(100)
              setNewOpen(true)
            }}
          >
            新建行程篮
          </button>
        </div>
      </div>

      {!plan ? (
        <div className="empty">
          <p>还没有行程篮。新建一个，然后从路线列表把路线加进来。</p>
          <button className="btn btn-primary" onClick={() => createPlan('我的百公里行程', 100)}>
            新建行程篮
          </button>
        </div>
      ) : (
        <>
          <div className={`${styles['plan-summary']}`}>
            <div className={`${styles['plan-target']}`}>
              <label>
                目标里程（km）
                <div className={`${styles['target-row']}`}>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={target}
                    onChange={(e) => setTarget(Number(e.target.value))}
                  />
                  <button className="btn btn-sm" onClick={() => setTarget(100)}>
                    100
                  </button>
                  <button className="btn btn-sm" onClick={() => setTarget(OLLE_TOTAL_KM)}>
                    {OLLE_TOTAL_KM}（全程）
                  </button>
                </div>
              </label>
              <label>
                行程篮名称
                <input className="input" value={plan.name} onChange={(e) => rename(e.target.value)} />
              </label>
            </div>
            <div className={`plan-result ${done ? 'is-done' : ''}`}>
              <div className={`${styles['plan-result-km']}`}>
                <b>{formatKm(total)}</b>
                <span>/ {target} km</span>
              </div>
              <div className="progress progress-lg">
                <div className={`progress-bar ${done ? 'is-done' : ''}`} style={{ width: `${pct}%` }} />
              </div>
              <div className={`${styles['plan-result-tip']}`}>
                {done
                  ? `已达标，超出 ${formatKm(total - target)} km`
                  : `还差 ${formatKm(gap)} km，从下面挑几条补上即可`}
              </div>
            </div>
          </div>

          {/* 行程位置地图：常驻区块，位置和以前一样（在汇总卡之后），不参与视图切换 */}
          {rows.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>行程位置</h2>
                {/* 住宿标一次能有十几个，压在线上看不清路线时切「仅路径」整批收起来 */}
                {(planHotels.length > 0 || confirmedHotels.length > 0) && (
                  <div className={`${styles['map-modes']}`} role="group" aria-label="地图住宿显示模式">
                    {MAP_STAY_MODES.map((m) => (
                      <button
                        key={m.key}
                        className={`btn btn-sm${stayMode === m.key ? ' is-active' : ''}`}
                        onClick={() => setStayMode(m.key)}
                        title={m.hint}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="muted">
                已加入行程篮的各段路线在地图上的分布（黑标=路线编号，紫=住宿，橙=看点）。
                标识落在每段线中间，避开相邻路线共享的端点；有真实轨迹的按轨迹画线，
                其余连途经点。<strong>虚线（灰绿）= 这条线还没有实测轨迹</strong>，
                只是把近似坐标连起来示意，走向不作数。
                住宿标太密时用右上角的模式按钮切到「仅路径」或「已确认住宿」。
                「已确认住宿」模式下紫标是带字的药丸（前夜 / 第2天 / 第1-2天），一眼看清哪一晚住哪家。
                底图加载失败时自动降级为离线示意图，位置信息不受影响。
              </p>
              {stayMode === 'confirmed' && confirmedHotels.length === 0 && (
                <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
                  还没有确认任何住宿 —— 切到「按天」，在每晚的住宿卡上点「住这家」锁定后，这里就会出现。
                </p>
              )}
              <RouteMap
                trails={planTrails}
                lines={planLines}
                approxLines={planApprox}
                badges={planBadges}
                hotels={mapHotels}
                hotelBadges={mapHotelBadges}
                hotelNotes={mapHotelNotes}
                sights={planSights}
                height={380}
                fixedZoom={10}
                center={{ lng: 126.5992, lat: 33.3747 }}
              />
            </section>
          )}

          {/* 视图切换（左）· 出发日 + 导出行程单（右，两者挨在一起） */}
          <div className={`${styles['plan-toolbar']}`}>
            <div className={`${styles.tabs}`}>
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  className={`tab${view === v.key ? ' is-active' : ''}`}
                  onClick={() => changeView(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <span className={`${styles.spacer}`} />
            {/* 出发地和导出放一组：改完日期立刻能导出，扫描视线是一趟从左到右 */}
            <div className={`${styles['export-group']}`}>
              <label className={`${styles['date-field']}`}>
                <span className="muted">出发日</span>
                <DatePicker
                  value={plan.startDate ?? ''}
                  onChange={(v) => setStartDate(v || undefined)}
                  placeholder="出发日"
                  ariaLabel="出发日"
                  title="填了之后，「按天」视图和行程单上会显示日期与星期"
                />
              </label>
              <button
                className="btn btn-primary"
                onClick={() => setExportOpen(true)}
                disabled={rows.length === 0}
              >
                导出行程单
              </button>
            </div>
          </div>

          {view === 'days' && (
            <>
              <div className={`${styles['day-summary']}`}>
                <div>
                  <span className="muted">已排天数</span>
                  <b>{planDayNumbers(plan).length}</b>
                </div>
                <div>
                  <span className="muted">待安排</span>
                  <b>{backlog.length} 条</b>
                </div>
                <div title="出发前一晚 + 每一天当晚（含最后一天）">
                  <span className="muted">需住宿</span>
                  <b>{nights} 晚</b>
                </div>
                <div>
                  <span className="muted">日均里程</span>
                  <b>{usedDays.length ? `${formatKm(total / usedDays.length)} km` : '—'}</b>
                </div>
                {overloaded.length > 0 && (
                  <span className={`${styles['warn-tag']}`}>⚠ 第 {overloaded.join('、')} 天超载</span>
                )}
              </div>
              <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
                把卡片拖到某一天，或用卡上的下拉选天（手机上用这个），同一天内用 ↑↓ 调顺序。
                「出发前一晚」和每天晚上都会给出住宿建议 —— 依据各路线自带的官方住宿口径，
                以及你在素材管理里录入的附近住宿（前夜按离第一天出发点近排，每晚按离当晚终点、
                明早起点的加权距离排）。
                {overloaded.length > 0 && ' ⚠ 单日超过 20 km 或 6.5 小时会提示这天偏重。'}
              </p>
              <DayBoard
                rows={dayRows}
                days={days}
                stays={stays}
                hotels={hotels}
                prevNight={prevNight}
                prevLabel={prevLabel}
                prevNote={plan.prevStayNote ?? ''}
                onSetPrevNote={setPrevStayNote}
                onLockPrevStay={setPrevStay}
                onAssignDay={assignDay}
                onMoveInDay={moveInDay}
                onRemove={removeRoute}
                onToggleDone={toggleDone}
                onLockStay={(day, hotelId) => lockStay(day, hotelId)}
                onAddDay={addDay}
                onRemoveDay={removeDay}
                noteOfDay={(day) => plan.dayNotes?.[day] ?? ''}
                onSetDayNote={setDayNote}
              />
            </>
          )}

          {view === 'list' && (
            <section className="section">
              <div className="section-head">
                <h2>
                  已加入 <span className="count">{rows.length}</span>
                </h2>
                {rows.length > 0 && (
                  <div className="btn-row">
                    <button
                      className={`btn btn-sm${hideDone ? ' is-active' : ''}`}
                      onClick={() => setHideDone(!hideDone)}
                    >
                      只看未完成
                    </button>
                    <button
                      className={`btn btn-sm${sort === 'added' ? ' is-active' : ''}`}
                      onClick={() => setSort('added')}
                    >
                      按加入顺序
                    </button>
                    <button
                      className={`btn btn-sm${sort === 'km' ? ' is-active' : ''}`}
                      onClick={() => setSort('km')}
                    >
                      按里程
                    </button>
                  </div>
                )}
              </div>

              {rows.length > 0 && (
                <div className={`${styles['plan-done']}`}>
                  <div className={`progress ${styles['progress-sm']}`}>
                    <div
                      className={`progress-bar${allDone ? ' is-done' : ''}`}
                      style={{ width: `${donePct}%` }}
                    />
                  </div>
                  <span className="muted">
                    {allDone
                      ? `全部走完啦 · 共 ${formatKm(doneKm)} km`
                      : `已完成 ${doneCount} / ${totalCount} 条 · ${formatKm(doneKm)} km`}
                  </span>
                </div>
              )}

              {rows.length === 0 ? (
                <div className="empty">
                  <p>行程篮是空的。</p>
                  <Link to="/" className="btn btn-primary">
                    去挑路线
                  </Link>
                </div>
              ) : visibleRows.length === 0 ? (
                <div className="empty">
                  <p>没有未完成的路线，都走完啦 🎉</p>
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th className={`${styles['th-done']}`} title="标记走完">
                        <span className={`${styles['sr-only']}`}>完成</span>
                      </th>
                      <th className={`${styles['th-idx']}`}>序</th>
                      <th>路线</th>
                      <th>里程</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r, idx) => (
                      <tr key={r.route.id} className={r.done ? 'is-done' : ''}>
                        <td className={`${styles['td-done']}`}>
                          <input
                            type="checkbox"
                            checked={r.done}
                            onChange={() => toggleDone(r.route.id)}
                            aria-label={`标记 ${r.route.name} 已走完`}
                          />
                        </td>
                        <td className={`${styles['td-idx']}`}>{idx + 1}</td>
                        <td>
                          <Link to={`/routes/${r.route.id}`}>{r.route.name}</Link>
                          {r.item.day !== undefined && <span className="pill">第 {r.item.day} 天</span>}
                        </td>
                        <td>
                          <b>{formatKm(r.km)} km</b>
                        </td>
                        <td className="td-right">
                          <button className="btn btn-sm" onClick={() => removeRoute(r.route.id)}>
                            移除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className={`${styles['td-done']}`} />
                      <td className={`${styles['td-idx']}`} />
                      <td>合计</td>
                      <td>
                        <b>{formatKm(total)} km</b>
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </section>
          )}

          {!done && suggestions.length > 0 && (
            <section className="section">
              <h2>还差 {formatKm(gap)} km，这几条可以补上</h2>
              <div className="list">
                {suggestions.map(({ route, km }) => (
                  <div key={route.id} className="list-item">
                    <div className="list-main">
                      <b>{route.name}</b>
                      <span className="muted">{route.region || '—'}</span>
                    </div>
                    <div className="list-side">
                      <span className="pill">{formatKm(km)} km</span>
                      <button className="btn btn-sm btn-primary" onClick={() => addRoute(route.id)}>
                        加入
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className={`${styles['plan-foot']}`}>
            <button className="btn" onClick={copyMarkdown}>
              复制为 Markdown
            </button>
            <button
              className="btn"
              onClick={async () => {
                if (await confirm({ title: '清空行程篮', message: '移除行程篮里的全部路线？', confirmText: '清空', danger: true })) {
                  clear()
                  toast('已清空', 'success')
                }
              }}
            >
              清空
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                if (await confirm({ title: '删除行程篮', message: `删除「${plan.name}」？不可恢复。`, confirmText: '删除', danger: true })) {
                  removePlan(plan.id)
                  toast('已删除', 'success')
                }
              }}
            >
              删除行程篮
            </button>
          </div>
        </>
      )}

      <Modal
        open={newOpen}
        title="新建行程篮"
        width={440}
        onClose={() => setNewOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setNewOpen(false)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                createPlan(newName.trim() || '未命名行程', newTarget)
                setNewOpen(false)
                toast('已创建', 'success')
              }}
            >
              创建
            </button>
          </>
        }
      >
        <label className="field">
          <span>名称</span>
          <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <label className="field">
          <span>目标里程（km）</span>
          <input className="input" type="number" min={1} value={newTarget} onChange={(e) => setNewTarget(Number(e.target.value))} />
        </label>
      </Modal>

      {plan && rows.length > 0 && (
        <Modal
          open={exportOpen}
          title="行程单"
          width={860}
          onClose={() => setExportOpen(false)}
          footer={
            <div className={`${styles['export-foot']}`}>
              <label className={`${styles['export-help-check']}`}>
                <input
                  type="checkbox"
                  checked={withHelp}
                  onChange={(e) => setWithHelp(e.target.checked)}
                />
                <span>附上备用信息页（紧急电话 + 中韩求助用语）</span>
              </label>
              <span className={`${styles.spacer}`} />
              {isMobile ? (
                <button className="btn btn-primary" onClick={saveAsImage} disabled={saving}>
                  {saving ? '生成中…' : '保存为图片'}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => window.print()}>
                  打印 / 存为 PDF
                </button>
              )}
              <button className="btn" onClick={copyMarkdown}>
                复制 Markdown
              </button>
              <button className="btn" onClick={() => setExportOpen(false)}>
                关闭
              </button>
            </div>
          }
        >
          <div ref={sheetRef}>
            <PlanPrintSheet
              plan={plan}
              rows={dayRows}
              days={days}
              stays={stays}
              prevNight={prevNight}
              prevLabel={prevLabel}
              metrics={metrics}
            />
            {withHelp && <PlanHelpSheet />}
          </div>
        </Modal>
      )}
    </div>
  )
}
