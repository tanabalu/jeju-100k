import { useEffect, useRef, useState } from 'react'
import { useData } from '../store/DataContext'
import { exportBackup, importBackup, clearAllLocalData } from '../lib/storage'
import { generateTransferQr, type TransferResult } from '../lib/transfer'
import type { MapStyle } from '../types'
import { useConfirm, useToast } from '../components/Feedback'
import { Select } from '../components/Select'
import { Modal } from '../components/Modal'
import styles from './SettingsPage.module.less'

/** 重载通常一两帧就跑完了，不留一档下限的话旋转只是闪一下，跟文案闪跳没区别 */
const RELOAD_MIN_SPIN_MS = 450

export function SettingsPage() {
  const { settings, updateSettings, reload, loading } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  /** 「重新加载数据」按下的瞬间置真；等 context 的 loading 回落即视为完成 */
  const [reloading, setReloading] = useState(false)
  const spinStartedAt = useRef(0)
  /** 扫码迁移弹窗状态 */
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferErr, setTransferErr] = useState('')
  const [qr, setQr] = useState<TransferResult | null>(null)

  useEffect(() => {
    if (!reloading || loading) return
    const wait = Math.max(0, RELOAD_MIN_SPIN_MS - (Date.now() - spinStartedAt.current))
    const timer = window.setTimeout(() => {
      setReloading(false)
      toast('已重新加载本机数据', 'success')
    }, wait)
    return () => window.clearTimeout(timer)
  }, [reloading, loading, toast])

  const handleReload = () => {
    if (reloading) return
    spinStartedAt.current = Date.now()
    setReloading(true)
    reload()
  }

  const setStyle = (mapStyle: MapStyle) => {
    updateSettings({ mapStyle })
    toast('已切换底图样式', 'success')
  }

  const handleExport = () => {
    const blob = new Blob([exportBackup()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jejuolle100k-backup-${new Date().toISOString().slice(0, 10)}.json`
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

  const openTransfer = async () => {
    setTransferOpen(true)
    setQr(null)
    setTransferErr('')
    setTransferBusy(true)
    try {
      const r = await generateTransferQr()
      setQr(r)
    } catch (err) {
      setTransferErr(err instanceof Error ? err.message : String(err))
    } finally {
      setTransferBusy(false)
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
          <button className="btn btn-sm" onClick={openTransfer} aria-busy={transferBusy}>
            扫码迁移到手机
          </button>
        </div>
        <p className="muted">
          扫码迁移：PC 端生成二维码，手机在同 WiFi 下扫码即可把路线/行程篮/设置导入手机
          （需先在 PC 终端运行 <code>npm run relay</code> 启动一次性局域网中继）。
        </p>
        <div className="btn-row">
          <button className="btn" onClick={handleReload} aria-busy={reloading}>
            <svg
              className={`${styles['reload-icon']} ${reloading ? styles['is-spinning'] : ''}`}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 0 0-8 8 8 8 0 0 0 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18a6 6 0 0 1-6-6 6 6 0 0 1 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z" />
            </svg>
            重新加载数据
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
                // 清整个 jejuolle100k.* 命名空间（含 jejuolle100k.checklist 行前准备、
                // jejuolle100k.settings / ui / planDraft 等），而非只删 routes/plans。
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

      <Modal open={transferOpen} title="扫码迁移到手机" onClose={() => setTransferOpen(false)}>
        {transferBusy && <p className="muted">正在生成本机数据二维码…</p>}
        {transferErr && (
          <p className="muted" style={{ color: 'var(--danger)' }}>
            {transferErr}
          </p>
        )}
        {qr && (
          <div style={{ textAlign: 'center' }}>
            <img
              src={qr.qrDataUrl}
              alt="迁移二维码"
              style={{ width: 280, height: 280, maxWidth: '100%' }}
            />
            <p className="muted">
              用手机扫码，在<b>同一 WiFi</b>下打开链接，即可把 PC 上的路线 / 行程篮 / 设置导入手机。
            </p>
            <p className="muted">若扫码失败，可在手机浏览器手动打开：</p>
            <p style={{ wordBreak: 'break-all', fontSize: 12, color: 'var(--muted)' }}>
              {qr.receiveUrl}
            </p>
            <p className="muted">中继为一次性，约 5 分钟后自动关闭。</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
