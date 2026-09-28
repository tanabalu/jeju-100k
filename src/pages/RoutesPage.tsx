import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../store/DataContext'
import { computeMetrics, formatKm } from '../lib/geo'
import type { Route } from '../types'
import { RouteCard } from '../components/RouteCard'
import { ListSkeleton } from '../components/Skeleton'
import { useActivePlan } from '../hooks/useActivePlan'
import { useToast } from '../components/Feedback'

type SortKey = 'code' | 'distance' | 'updated' | 'name'

export function RoutesPage() {
  const { routes, loading, staleSeed, refreshSeedRoutes } = useData()
  const { plan, plans, selectPlan } = useActivePlan()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | Route['kind']>('all')
  const [sort, setSort] = useState<SortKey>('code')

  const metrics = useMemo(() => new Map(routes.map((r) => [r.id, computeMetrics(r)])), [routes])

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    let out = routes.filter((r) => {
      if (kind !== 'all' && r.kind !== kind) return false
      if (!kw) return true
      return (
        r.name.toLowerCase().includes(kw) ||
        r.region.toLowerCase().includes(kw) ||
        r.tags.some((t) => t.toLowerCase().includes(kw))
      )
    })
    out = [...out].sort((a, b) => {
      if (sort === 'code') {
        const na = parseFloat(a.code ?? '999')
        const nb = parseFloat(b.code ?? '999')
        if (na !== nb) return na - nb
        return (a.code ?? '').localeCompare(b.code ?? '')
      }
      if (sort === 'distance') return (metrics.get(b.id)?.distanceKm ?? 0) - (metrics.get(a.id)?.distanceKm ?? 0)
      if (sort === 'updated') return b.updatedAt - a.updatedAt
      return a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
    return out
  }, [routes, q, kind, sort, metrics])

  const planTotal = useMemo(() => {
    if (!plan) return 0
    return plan.items.reduce((sum, i) => {
      const r = routes.find((x) => x.id === i.routeId)
      return sum + (r ? (metrics.get(r.id)?.distanceKm ?? 0) : 0)
    }, 0)
  }, [plan, routes, metrics])

  const target = plan?.targetKm ?? 100
  const pct = Math.min(100, (planTotal / Math.max(target, 1)) * 100)

  return (
    <div className="page">
      {staleSeed && (
        <div className="notice-bar">
          <span>
            默认素材有更新：会给 27 条偶来小路补上地形剖面与累计爬升（旧数据爬升显示为 0）。
            更新只写地形字段，你自己录的住宿 / 看点 / 相册和自建路线都不会动。
          </span>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              const res = refreshSeedRoutes()
              toast(
                `已更新：新增 ${res.added} 条，补齐地形 ${res.updated} 条，移除旧示例 ${res.removed} 条`,
                'success',
              )
            }}
          >
            补齐爬升数据
          </button>
        </div>
      )}

      <div className="plan-mini">
        <div className="plan-mini-left">
          <span className="plan-mini-label">当前行程篮</span>
          {/* 直接切换行程篮：卡片上的「加入」会加进这里选中的那个 */}
          {plans.length > 0 ? (
            <select
              className="input plan-mini-select"
              value={plan?.id ?? ''}
              onChange={(e) => selectPlan(e.target.value)}
              title="切换当前行程篮"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <strong>（还没有行程篮）</strong>
          )}
          <span className="plan-mini-km">
            {formatKm(planTotal)} / {target} km
          </span>
          {plan && <span className="muted">已加入 {plan.items.length} 条</span>}
        </div>
        <div className="progress">
          <div className={`progress-bar ${planTotal >= target ? 'is-done' : ''}`} style={{ width: `${pct}%` }} />
        </div>
        <Link to="/plan" className="btn btn-sm btn-primary">
          去凑百公里
        </Link>
      </div>

      <div className="toolbar">
        <input
          className="input"
          placeholder="搜索路线名 / 地区 / 标签"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as 'all' | Route['kind'])}>
          <option value="all">全部类型</option>
          <option value="hike">徒步</option>
          <option value="trailrun">越野跑</option>
          <option value="fastpack">轻装快穿</option>
        </select>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="code">按路线编号</option>
          <option value="distance">按里程排序</option>
          <option value="updated">按更新时间</option>
          <option value="name">按名称</option>
        </select>
        <Link to="/admin" className="btn btn-sm">
          管理素材
        </Link>
      </div>

      {loading ? (
        <ListSkeleton rows={3} />
      ) : list.length === 0 ? (
        <div className="empty">
          <p>没有匹配的路线。</p>
          <Link to="/admin" className="btn btn-primary">
            去添加第一条路线
          </Link>
        </div>
      ) : (
        <div className="grid-cards">
          {list.map((r) => (
            <RouteCard key={r.id} route={r} />
          ))}
        </div>
      )}
    </div>
  )
}
