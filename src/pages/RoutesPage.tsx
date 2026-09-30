import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../store/DataContext'
import { computeMetrics, formatKm } from '../lib/geo'
import { RouteCard } from '../components/RouteCard'
import { Select } from '../components/Select'
import { ListSkeleton } from '../components/Skeleton'
import { useActivePlan } from '../hooks/useActivePlan'
import styles from './RoutesPage.module.less'

type SortKey = 'code' | 'distance' | 'difficulty' | 'difficultyAsc'

export function RoutesPage() {
  const { routes, loading } = useData()
  const { plan, plans, selectPlan } = useActivePlan()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('code')

  const metrics = useMemo(() => new Map(routes.map((r) => [r.id, computeMetrics(r)])), [routes])

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    let out = routes.filter((r) => {
      if (!kw) return true
      return (
        r.name.toLowerCase().includes(kw) ||
        r.region.toLowerCase().includes(kw) ||
        r.tags.some((t) => t.toLowerCase().includes(kw))
      )
    })
    const byCode = (a: (typeof out)[number], b: (typeof out)[number]) => {
      const na = parseFloat(a.code ?? '999')
      const nb = parseFloat(b.code ?? '999')
      if (na !== nb) return na - nb
      return (a.code ?? '').localeCompare(b.code ?? '')
    }
    out = [...out].sort((a, b) => {
      if (sort === 'code') return byCode(a, b)
      if (sort === 'difficulty') {
        // 难度：星级多（难）在前；同难度按路线编号升序，保证顺序稳定
        const d = (b.difficulty ?? 0) - (a.difficulty ?? 0)
        if (d !== 0) return d
        return byCode(a, b)
      }
      if (sort === 'difficultyAsc') {
        // 难度：星级少（易）在前；同难度按路线编号升序，保证顺序稳定
        const d = (a.difficulty ?? 0) - (b.difficulty ?? 0)
        if (d !== 0) return d
        return byCode(a, b)
      }
      if (sort === 'distance') return (metrics.get(b.id)?.distanceKm ?? 0) - (metrics.get(a.id)?.distanceKm ?? 0)
      return byCode(a, b)
    })
    return out
  }, [routes, q, sort, metrics])

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
      <div className={`${styles['plan-mini']}`}>
        <div className={`${styles['plan-mini-left']}`}>
          <span className={`${styles['plan-mini-label']}`}>当前行程篮</span>
          {/* 直接切换行程篮：卡片上的「加入」会加进这里选中的那个 */}
          {plans.length > 0 ? (
            <Select
              className={styles['plan-mini-select']}
              value={plan?.id ?? ''}
              onChange={selectPlan}
              options={plans.map((p) => ({ value: p.id, label: p.name }))}
              ariaLabel="切换当前行程篮"
            />
          ) : (
            <strong>（还没有行程篮）</strong>
          )}
          <span className={`${styles['plan-mini-km']}`}>
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

      <div className={`${styles['toolbar']}`}>
        <input
          className="input"
          placeholder="搜索路线名 / 地区 / 标签"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          value={sort}
          onChange={(v) => setSort(v as SortKey)}
          options={[
            { value: 'code', label: '按路线编号' },
            { value: 'distance', label: '按里程排序' },
            { value: 'difficulty', label: '按难度排序（难→易）' },
            { value: 'difficultyAsc', label: '按难度排序（易→难）' },
          ]}
          ariaLabel="排序方式"
        />
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
