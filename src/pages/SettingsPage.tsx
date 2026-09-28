import { useData } from '../store/DataContext'
import type { MapStyle } from '../types'
import { useConfirm, useToast } from '../components/Feedback'

export function SettingsPage() {
  const { settings, updateSettings, reload, staleSeed, refreshSeedRoutes } = useData()
  const toast = useToast()
  const confirm = useConfirm()

  const setStyle = (mapStyle: MapStyle) => {
    updateSettings({ mapStyle })
    toast('已切换底图样式', 'success')
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
          <div className="seg">
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
          换设备或清理浏览器数据前，请到管理后台导出 JSON 备份。
        </p>
        <div className="btn-row">
          <button className="btn" onClick={reload}>
            重新加载数据
          </button>
          <button
            className="btn"
            disabled={!staleSeed}
            onClick={() => {
              const res = refreshSeedRoutes()
              toast(
                `已更新：新增 ${res.added} 条，补齐地形 ${res.updated} 条，移除旧示例 ${res.removed} 条`,
                'success',
              )
            }}
          >
            {staleSeed ? '更新素材（补地形与爬升）' : '默认素材已是最新'}
          </button>
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (
                await confirm({
                  title: '清空全部数据',
                  message: '会删除本机的全部路线与行程篮（示例数据会重新生成）。确定继续？',
                  confirmText: '清空',
                  danger: true,
                })
              ) {
                localStorage.removeItem('trail100k.routes')
                localStorage.removeItem('trail100k.plans')
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
