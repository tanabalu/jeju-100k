import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../store/DataContext'
import { exportBackup, importBackup } from '../lib/storage'
import { computeMetrics, formatKm } from '../lib/geo'
import { useToast } from '../components/Feedback'
import type { Route } from '../types'
import { BasicForm } from './admin/BasicForm'
import { PointsEditor } from './admin/PointsEditor'
import { HotelsEditor } from './admin/HotelsEditor'
import { SightsEditor } from './admin/SightsEditor'
import { AlbumEditor } from './admin/AlbumEditor'

type Tab = 'basic' | 'points' | 'hotels' | 'sights' | 'album'

const TABS: { key: Tab; label: string }[] = [
  { key: 'basic', label: '基本信息' },
  { key: 'points', label: '途经点 / 起终点' },
  { key: 'hotels', label: '附近住宿' },
  { key: 'sights', label: '路边景色' },
  { key: 'album', label: '相册' },
]

export function AdminPage() {
  const { routes, upsertRoute, reload } = useData()
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const routeId = params.get('route') ?? ''
  const route = useMemo(() => routes.find((r) => r.id === routeId), [routes, routeId])
  const [tab, setTab] = useState<Tab>('basic')
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')

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

  const handleExport = () => {
    const blob = new Blob([exportBackup()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trail100k-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('已导出备份文件', 'success')
  }

  const handleImport = async (file?: File) => {
    if (!file) return
    try {
      const text = await file.text()
      const res = importBackup(text, importMode)
      reload()
      toast(`导入完成：${res.routes} 条路线`, 'success')
    } catch (err) {
      toast(`导入失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="page">
      <div className="admin-head">
        <div>
          <h1 className="detail-title">素材管理后台</h1>
          <p className="muted">在这里查看 / 编辑已有路线的素材（起终点、住宿、看点、相册）。所有数据保存在本机浏览器。</p>
        </div>
        <div className="admin-head-actions">
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

      <div className="backup-bar">
        <span className="muted">数据备份</span>
        <button className="btn btn-sm" onClick={handleExport}>
          导出 JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => handleImport(e.target.files?.[0])}
        />
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
          导入 JSON
        </button>
        <select className="input input-sm" value={importMode} onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}>
          <option value="merge">合并（同 id 覆盖）</option>
          <option value="replace">替换（清空后导入）</option>
        </select>
      </div>

      {!route ? (
        <div className="empty">
          <p>没有可选路线。</p>
        </div>
      ) : (
        <>
          <div className="admin-meta">
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

          <div className="tabs">
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

          <div className="tab-panel">
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
