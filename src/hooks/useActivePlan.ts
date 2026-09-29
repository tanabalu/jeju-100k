import { useCallback, useEffect, useState } from 'react'
import type { Plan } from '../types'
import { useData } from '../store/DataContext'
import { store } from '../lib/storage'

/** 当前正在编辑的行程篮；没有时自动取第一个，仍没有则创建 */
export function useActivePlan() {
  const { plans, createPlan, upsertPlan, removePlan, setPlans } = useData()
  const [activeId, setActiveId] = useState<string>(() => store.getPlanDraftId())

  useEffect(() => {
    if (!activeId && plans.length > 0) {
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

  /** 加入行程篮；已在篮里则不做任何事（每条路线只算一次），返回是否真的加进去了 */
  const addRoute = useCallback(
    (routeId: string) => {
      const target = ensurePlan()
      if (target.items.some((i) => i.routeId === routeId)) return false
      upsertPlan({ ...target, items: [...target.items, { routeId }] })
      return true
    },
    [ensurePlan, upsertPlan],
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
    createPlan: (name?: string, targetKm?: number) => {
      const p = createPlan(name, targetKm)
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
