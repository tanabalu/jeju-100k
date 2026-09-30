import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../store/DataContext'
import { computeMetrics, formatKm } from '../lib/geo'
import type { Route } from '../types'
import { BasicForm } from './admin/BasicForm'
import { PointsEditor } from './admin/PointsEditor'
import { HotelsEditor } from './admin/HotelsEditor'
import { SightsEditor } from './admin/SightsEditor'
import { AlbumEditor } from './admin/AlbumEditor'
import styles from './AdminPage.module.less'

type Tab = 'basic' | 'points' | 'hotels' | 'sights' | 'album'

const TABS: { key: Tab; label: string }[] = [
  { key: 'basic', label: '基本信息' },
  { key: 'points', label: '途经点 / 起终点' },
  { key: 'hotels', label: '附近住宿' },
  { key: 'sights', label: '路边景色' },
  { key: 'album', label: '相册' },
]

export function AdminPage() {
  const { routes, upsertRoute } = useData()
  const [params, setParams] = useSearchParams()

  const routeId = params.get('route') ?? ''
  const route = useMemo(() => routes.find((r) => r.id === routeId), [routes, routeId])
  const [tab, setTab] = useState<Tab>('basic')

  useEffect(() => {
    if (!routeId && routes.length > 0) {
      setParams({ route: routes[0].id }, { replace: true })
    }
  }, [routeId, routes, setParams])

  const patch = (p: Partial<Route>) => {
    if (!route) return
    upsertRoute({ ...route, ...p })
  }

  const metrics = route ? computeMetrics(route) : undefined

  return (
    <div className="page">
      <div className={`${styles['admin-head']}`}>
        <div>
          <h1 className="detail-title">素材管理后台</h1>
          <p className="muted">在这里查看 / 编辑已有路线的素材（起终点、住宿、看点、相册）。所有数据保存在本机浏览器。</p>
        </div>
        <div className={`${styles['admin-head-actions']}`}>
          <select
            className="input"
            value={routeId}
            onChange={(e) => setParams({ route: e.target.value })}
          >
            {routes.length === 0 && <option value="">（暂无路线）</option>}
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!route ? (
        <div className="empty">
          <p>没有可选路线。</p>
        </div>
      ) : (
        <>
          <div className={`${styles['admin-meta']}`}>
            <span>
              当前里程：<b>{formatKm(metrics?.distanceKm ?? 0)} km</b>
              {route.manualDistanceKm ? '（手填）' : '（估算）'}
            </span>
            <span>
              爬升 {metrics?.gainM == null ? '—' : `${metrics.gainM} m`}
              {metrics?.gainSource === 'profile' ? '（地形估算）' : ''}
              {metrics?.gainSource === 'manual' ? '（手填）' : ''}
            </span>
            <span>{route.points.length} 个途经点</span>
            <Link to={`/routes/${route.id}`} className="btn btn-sm">
              预览详情
            </Link>
          </div>

          <div className={`${styles['tabs']}`}>
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`tab ${tab === t.key ? 'is-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={`${styles['tab-panel']}`}>
            {tab === 'basic' && <BasicForm route={route} />}
            {tab === 'points' && <PointsEditor route={route} onPatch={patch} />}
            {tab === 'hotels' && <HotelsEditor route={route} onPatch={patch} />}
            {tab === 'sights' && <SightsEditor route={route} onPatch={patch} />}
            {tab === 'album' && <AlbumEditor route={route} onPatch={patch} />}
          </div>
        </>
      )}
    </div>
  )
}
