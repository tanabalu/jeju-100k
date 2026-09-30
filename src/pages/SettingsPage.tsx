import { useEffect, useRef, useState } from 'react'
import { useData } from '../store/DataContext'
import { exportBackup, importBackup, clearAllLocalData } from '../lib/storage'
import type { MapStyle } from '../types'
import { useConfirm, useToast } from '../components/Feedback'
import { Select } from '../components/Select'
import styles from './SettingsPage.module.less'

export function SettingsPage() {
  const { settings, updateSettings, reload, loading } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  /** 「重新加载数据」按下的瞬间置真；等 context 的 loading 回落即视为完成 */
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    if (reloading && !loading) {
      setReloading(false)
      toast('已重新加载本机数据', 'success')
    }
  }, [reloading, loading, toast])

  const setStyle = (mapStyle: MapStyle) => {
    updateSettings({ mapStyle })
    toast('已切换底图样式', 'success')
  }

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
      <h1 className="detail-title">设置</h1>

      <section className="section">
        <h2>地图底图</h2>
        <p className="muted">
          底图数据来自 <b>OpenStreetMap</b>，全球覆盖，济州岛的街道、海岸线、地形都能正常显示，
          <b>无需申请 Key、无需任何配置</b>。底图样式可随时切换，立即生效。
        </p>
        <div className="field">
          <span>底图样式</span>
          <div className={`${styles['seg']}`}>
            <button
              className={settings.mapStyle === 'standard' ? 'active' : ''}
              onClick={() => setStyle('standard')}
            >
              标准地图
            </button>
            <button
              className={settings.mapStyle === 'terrain' ? 'active' : ''}
              onClick={() => setStyle('terrain')}
            >
              地形图
            </button>
          </div>
        </div>
        <p className="muted">
          「标准地图」来自 OpenStreetMap，「地形图」来自 OpenTopoMap（带等高线与山体阴影，适合徒步）。
          两个图源都是免 Key 的公共服务，需要联网加载；离线时地图区域会是空白，
          其余功能（凑里程、住宿、看点、相册）不受影响。
        </p>
      </section>

      <section className="section">
        <h2>数据</h2>
        <p className="muted">
          路线、住宿、看点、相册都保存在当前浏览器的 localStorage 与 IndexedDB 中，不会上传到任何服务器。
          换设备或清理浏览器数据前，可在下方导出 / 导入 JSON 备份。
        </p>
        <div className={`${styles['backup-bar']}`}>
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
          <Select
            size="sm"
            value={importMode}
            onChange={(v) => setImportMode(v as 'merge' | 'replace')}
            options={[
              { value: 'merge', label: '合并（同 id 覆盖）' },
              { value: 'replace', label: '替换（清空后导入）' },
            ]}
            ariaLabel="导入方式"
          />
        </div>
        <div className="btn-row">
          <button
            className="btn"
            disabled={reloading}
            onClick={() => {
              setReloading(true)
              reload()
            }}
          >
            {reloading ? '加载中…' : '重新加载数据'}
          </button>
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (
                await confirm({
                  title: '清空全部数据',
                  message:
                    '会删除本机全部本地数据，包括路线、行程篮与行前准备（示例数据会重新生成）。确定继续？',
                  confirmText: '清空',
                  danger: true,
                })
              ) {
                // 清整个 trail100k.* 命名空间（含 trail100k.checklist 行前准备、
                // trail100k.settings / ui / planDraft 等），而非只删 routes/plans。
                clearAllLocalData()
                reload()
                toast('已清空', 'success')
              }
            }}
          >
            清空全部数据
          </button>
        </div>
      </section>
    </div>
  )
}
