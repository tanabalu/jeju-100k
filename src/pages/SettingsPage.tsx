import { useState } from 'react'
import { useData } from '../store/DataContext'
import { detectMode } from '../lib/mapLoader'
import { useConfirm, useToast } from '../components/Feedback'

export function SettingsPage() {
  const { settings, updateSettings, reload, staleSeed, refreshSeedRoutes } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const [key, setKey] = useState(settings.tmapKey)
  const mode = detectMode(settings.tmapKey)

  return (
    <div className="page">
      <h1 className="detail-title">设置</h1>

      <section className="section">
        <h2>地图底图</h2>
        <p className="muted">
          底图使用腾讯位置服务（具备测绘资质）。<b>济州岛属于海外区域，不适用本地代理模式</b>：
          想在地图上看到真实底图，必须填入你自己的 Key；没填 Key 时页面会自动降级成路线示意图，
          凑里程、住宿、看点、相册这些功能照常可用。
        </p>
        <div className="field">
          <span>腾讯地图 Key</span>
          <input
            className="input"
            placeholder="留空则使用本地代理模式"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        <div className="btn-row">
          <button
            className="btn btn-primary"
            onClick={() => {
              updateSettings({ tmapKey: key.trim() })
              toast('已保存，刷新页面后生效', 'success')
            }}
          >
            保存
          </button>
          <span className={`status status-${mode}`}>
            当前模式：
            {mode === 'key' ? '自有 Key' : mode === 'proxy' ? '本地代理（无需 Key）' : '底图不可用（降级示意图）'}
          </span>
        </div>

        <div className="callout">
          <b>申请 Key 的步骤</b>
          <ol>
            <li>打开腾讯位置服务开放平台（lbs.qq.com），注册并登录。</li>
            <li>进入「控制台 → 应用管理 → 创建应用」，填写应用名称与类型。</li>
            <li>为该应用添加 Key，勾选「WebServiceAPI / JavaScript GL」，并填写域名白名单。</li>
            <li>复制生成的 Key 粘贴到上方输入框，保存并刷新页面。</li>
          </ol>
          <p className="muted">
            前端明文 Key 存在被抓取的风险：个人自用请在平台配置 Referer 域名白名单；对外商用请把地图请求放到后端代理。
          </p>
        </div>
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
