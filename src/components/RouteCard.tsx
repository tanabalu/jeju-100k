import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Route } from '../types'
import { computeMetrics, formatKm } from '../lib/geo'
import { useData } from '../store/DataContext'
import { Thumb } from './Thumb'
import { routeKindLabel } from '../lib/routeKind'
import { useActivePlan } from '../hooks/useActivePlan'
import styles from './RouteCard.module.less'

export function RouteCard({ route }: { route: Route }) {
  const m = useMemo(() => computeMetrics(route), [route])
  const { plans } = useData()
  const { addRoute, has } = useActivePlan()
  const added = has(route.id)
  const is100 = m.distanceKm >= 100
  // 「已完成」= 这条线在**任意一个**行程篮里被勾过「走完」；不影响再加入其他行程篮
  const donePlan = useMemo(
    () => plans.find((p) => p.items.some((i) => i.routeId === route.id && i.done)),
    [plans, route.id],
  )

  return (
    <div className="card route-card">
      <div className={`${styles['route-cover']}`}>
        {route.cover ? (
          <Thumb image={route.cover} alt={route.name} radius={0} />
        ) : (
          /* 地区信息只在下面的 meta 行出现一次，占位图不重复显示 */
          <div className={`${styles['cover-placeholder']}`}>
            <span>暂无配图</span>
          </div>
        )}
        {route.code && <span className={`${styles['code-badge']}`}>{route.code}</span>}
        {donePlan && (
          <span
            className={`${styles['done-badge']}`}
            title={`已在「${donePlan.name}」行程篮中标记走完`}
            aria-label="已完成"
          >
            ✓
          </span>
        )}
        {is100 && <span className={`${styles['badge']} ${styles['badge-100']}`}>百公里</span>}
      </div>
      <div className={`${styles['route-body']}`}>
        <Link to={`/routes/${route.id}`} className={`${styles['route-title']}`}>
          {route.name}
        </Link>
        <div className="route-meta">
          <span>{route.region || '—'}</span>
          <span>·</span>
          <span>{routeKindLabel(route.kind)}</span>
          <span>·</span>
          <span>难度 {'★'.repeat(Math.max(1, Math.min(5, route.difficulty)))}</span>
        </div>
        <div className={`${styles['route-stats']}`}>
          <div>
            <b>
              {formatKm(m.distanceKm)}
              <i>km</i>
            </b>
            <em>里程</em>
          </div>
          <div>
            <b>
              {m.gainM == null ? '—' : m.gainM}
              {m.gainM != null && <i>m</i>}
            </b>
            <em>爬升{m.gainSource === 'profile' ? '（估算）' : ''}</em>
          </div>
          <div>
            <b>{route.points.length}</b>
            <em>个途经点</em>
          </div>
          <div>
            <b>{route.sights.length}</b>
            <em>看点</em>
          </div>
        </div>
        {route.tags.length > 0 && (
          <div className={`${styles['tag-row']}`}>
            {route.tags.slice(0, 5).map((t) => (
              <span key={t} className={`${styles['tag']}`}>
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="route-actions">
          <Link to={`/routes/${route.id}`} className="btn btn-sm">
            查看详情
          </Link>
          <button
            className="btn btn-sm btn-primary"
            disabled={added}
            onClick={() => addRoute(route.id)}
            title={added ? '已在当前行程篮里，每条路线只算一次' : undefined}
          >
            {added ? '已加入' : '加入行程篮'}
          </button>
        </div>
      </div>
    </div>
  )
}
