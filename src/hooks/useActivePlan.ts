import { useCallback, useEffect, useState } from 'react'
import type { Plan } from '../types'
import { useData } from '../store/DataContext'
import { store } from '../lib/storage'
import {
  assignDayItems,
  moveInDayItems,
  planDayNumbers,
  removeDayItems,
  setStayItems,
} from '../lib/dayPlan'

/** 允许「删除」的字段 —— 只有可选字段能被 delete，TS 也是这么要求的 */
type PlanOptionalKey = 'startDate' | 'dayNotes' | 'dayCount' | 'prevStayId' | 'prevStayNote'

/** 当前正在编辑的行程篮；没有时自动取第一个，仍没有则创建 */
export function useActivePlan() {
  const { plans, createPlan, upsertPlan, removePlan, setPlans } = useData()
  const [activeId, setActiveId] = useState<string>(() => store.getPlanDraftId())

  /**
   * activeId 可能指向一个已经不存在的行程篮（上次会话删过、或导备份时被替换），
   * 这时 `plan` 恒为 undefined，界面会停留在「还没有行程篮」的空态，
   * 而用户其实是有篮的 —— 一律回落到第一个。
   */
  useEffect(() => {
    if (plans.length === 0) return
    if (!activeId || !plans.some((p) => p.id === activeId)) {
      setActiveId(plans[0].id)
      store.setPlanDraftId(plans[0].id)
    }
  }, [activeId, plans])

  const plan: Plan | undefined = plans.find((p) => p.id === activeId)

  const selectPlan = useCallback(
    (id: string) => {
      setActiveId(id)
      store.setPlanDraftId(id)
    },
    [],
  )

  const ensurePlan = useCallback((): Plan => {
    if (plan) return plan
    const created = createPlan()
    setActiveId(created.id)
    return created
  }, [plan, createPlan])

  /** 加入行程篮；已在篮里则不做任何事（每条路线只算一次），返回是否真的加进去了。
   *
   * ⚠️ 没有行程篮时必须**一次写入**同时完成「建篮 + 加入这条」：
   * 先 `createPlan()` 建空篮、再 `upsertPlan()` 补 item 是两次 `setPlans`，
   * 一旦中间被别的状态更新插队（或多张路线卡各自持有一份 hook 实例时互相覆盖），
   * 结果就是按钮显示「已加入」而行程篮里空空如也 —— 这个坑踩过。
   */
  const addRoute = useCallback(
    (routeId: string) => {
      if (!plan) {
        const created = createPlan('我的百公里行程', 100, [{ routeId }])
        setActiveId(created.id)
        return true
      }
      if (plan.items.some((i) => i.routeId === routeId)) return false
      upsertPlan({ ...plan, items: [...plan.items, { routeId }] })
      return true
    },
    [plan, createPlan, upsertPlan],
  )

  const removeRoute = useCallback(
    (routeId: string) => {
      if (!plan) return
      upsertPlan({ ...plan, items: plan.items.filter((i) => i.routeId !== routeId) })
    },
    [plan, upsertPlan],
  )

  /** 切换某条路线的「已完成」状态，用于查看走完进度 */
  const toggleDone = useCallback(
    (routeId: string) => {
      if (!plan) return
      upsertPlan({
        ...plan,
        items: plan.items.map((i) =>
          i.routeId === routeId ? { ...i, done: !i.done } : i,
        ),
      })
    },
    [plan, upsertPlan],
  )

  const setTarget = useCallback(
    (targetKm: number) => {
      if (!plan) return
      upsertPlan({ ...plan, targetKm: Math.max(1, targetKm) })
    },
    [plan, upsertPlan],
  )

  const rename = useCallback(
    (name: string) => {
      if (!plan) return
      upsertPlan({ ...plan, name })
    },
    [plan, upsertPlan],
  )

  const clear = useCallback(() => {
    if (!plan) return
    upsertPlan({ ...plan, items: [] })
  }, [plan, upsertPlan])

  /** 改行程篮级的字段（出发日期 / 每天备注 / 显式天数），patch 里 undefined 表示删除 */
  const patchPlan = useCallback(
    (patch: Partial<Plan>, dropKeys: PlanOptionalKey[] = []) => {
      if (!plan) return
      const next: Plan = { ...plan, ...patch }
      dropKeys.forEach((k) => delete next[k])
      upsertPlan(next)
    },
    [plan, upsertPlan],
  )

  /* ---------------- 以下是「按天排期」的操作 ---------------- */

  /** 把某条路线分到第 day 天；传 undefined = 退回「待安排」 */
  const assignDay = useCallback(
    (routeId: string, day: number | undefined) => {
      if (!plan) return
      upsertPlan({ ...plan, items: assignDayItems(plan.items, routeId, day) })
    },
    [plan, upsertPlan],
  )

  /** 同一天内上移 / 下移一格 */
  const moveInDay = useCallback(
    (routeId: string, dir: -1 | 1) => {
      if (!plan) return
      upsertPlan({ ...plan, items: moveInDayItems(plan.items, routeId, dir) })
    },
    [plan, upsertPlan],
  )

  /**
   * 出发日。空值（清空）时才走 dropKeys 删字段 ——
   * `patchPlan({ startDate: iso }, ['startDate'])` 会把刚写进去的值立刻删掉，
   * 表现就是日期框选了但翻回来永远是空的。
   */
  const setStartDate = useCallback(
    (iso: string | undefined) => patchPlan({ startDate: iso }, iso ? [] : ['startDate']),
    [patchPlan],
  )

  /** 「出发前一晚」锁定 / 解锁住宿 */
  const setPrevStay = useCallback(
    (stayId: string | undefined) => patchPlan({ prevStayId: stayId }, stayId ? [] : ['prevStayId']),
    [patchPlan],
  )

  /** 「出发前一晚」的备注；空表示删掉 */
  const setPrevStayNote = useCallback(
    (text: string) => patchPlan({ prevStayNote: text }, text.trim() ? [] : ['prevStayNote']),
    [patchPlan],
  )

  /** 某一天的备注；空字符串表示删掉 */
  const setDayNote = useCallback(
    (day: number, text: string) => {
      if (!plan) return
      const notes = { ...(plan.dayNotes ?? {}) }
      if (text.trim()) notes[day] = text
      else delete notes[day]
      patchPlan({ dayNotes: notes }, Object.keys(notes).length ? [] : ['dayNotes'])
    },
    [plan, patchPlan],
  )

  /** 锁定 / 解锁某天的住宿 */
  const lockStay = useCallback(
    (day: number, stayId: string | undefined, note?: string) => {
      if (!plan) return
      upsertPlan({ ...plan, items: setStayItems(plan.items, day, stayId, note) })
    },
    [plan, upsertPlan],
  )

  /** 末尾加一个空天（空天在数据里没有实体，靠 dayCount 撑住） */
  const addDay = useCallback(() => {
    if (!plan) return
    const nums = planDayNumbers(plan)
    upsertPlan({ ...plan, dayCount: (nums.length ? nums[nums.length - 1] : 0) + 1 })
  }, [plan, upsertPlan])

  /** 删除第 day 天：该天路线退回待安排，后面的天整体前移 */
  const removeDay = useCallback(
    (day: number) => {
      if (!plan) return
      const items = removeDayItems(plan.items, day)
      const nums = planDayNumbers(plan)
      upsertPlan({ ...plan, items, dayCount: Math.max((nums.length ? nums[nums.length - 1] : 1) - 1, 0) || undefined })
    },
    [plan, upsertPlan],
  )

  return {
    plans,
    plan,
    activeId,
    selectPlan,
    ensurePlan,
    addRoute,
    removeRoute,
    toggleDone,
    setTarget,
    rename,
    clear,
    // 按天排期
    assignDay,
    moveInDay,
    setStartDate,
    setPrevStay,
    setPrevStayNote,
    setDayNote,
    lockStay,
    addDay,
    removeDay,
    /** 对外暴露的建篮入口：签名与 DataContext.createPlan 保持一致（可带初始 items） */
    createPlan: (name?: string, targetKm?: number, items?: import('../types').PlanItem[]) => {
      const p = createPlan(name, targetKm, items)
      setActiveId(p.id)
      return p
    },
    removePlan: (id: string) => {
      removePlan(id)
      if (id === activeId) setActiveId('')
    },
    setPlans,
    /** 行程篮里是否包含某路线（每条只算一次，所以是布尔值） */
    has: (routeId: string) => !!plan?.items.some((i) => i.routeId === routeId),
  }
}
