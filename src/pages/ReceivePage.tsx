import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { importBackup } from '../lib/storage'
import { useToast } from '../components/Feedback'

type State = 'loading' | 'done' | 'error'

/**
 * 手机端接收页（方案 A 的落点）。
 *
 * 入口由 PC 端生成的二维码决定：`<app-base>#/receive?src=<中继数据地址>`。
 * 手机扫码打开 App 的这个路由后，从这里跨域（中继开了 CORS）把 PC 的备份拉过来，
 * 直接写进手机浏览器的 localStorage —— 因为本页就在 App 自身 origin 内运行，
 * 所以 importBackup 写的是「手机上的 App 数据」，不是中继。
 */
export function ReceivePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [state, setState] = useState<State>('loading')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const src = params.get('src')
    if (!src) {
      setState('error')
      setMsg('链接缺少数据地址（src），无法导入。请重新在 PC 端生成二维码。')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(src, { mode: 'cors' })
        if (!res.ok) throw new Error(`中继返回 ${res.status}`)
        const text = await res.text()
        const r = importBackup(text, 'merge')
        if (cancelled) return
        setState('done')
        setMsg(`导入完成：${r.routes} 条路线、${r.plans} 个行程篮。`)
        toast('已从 PC 导入数据', 'success')
      } catch (err) {
        if (cancelled) return
        setState('error')
        const reason = err instanceof Error ? err.message : String(err)
        setMsg(reason)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [params, toast])

  return (
    <div className="page">
      <h1 className="detail-title">接收数据</h1>

      {state === 'loading' && <p className="muted">正在从 PC 拉取数据…</p>}

      {state === 'done' && (
        <>
          <p className="muted">{msg}</p>
          <p className="muted">数据已写入本机浏览器，可离线使用。</p>
          <div className="btn-row">
            <button className="btn" onClick={() => navigate('/')}>
              进入应用
            </button>
          </div>
        </>
      )}

      {state === 'error' && (
        <>
          <p className="muted">导入失败：{msg}</p>
          <p className="muted">
            请确认：① PC 与手机在<b>同一 WiFi</b>；② PC 端迁移中继仍在运行（默认 5
            分钟无操作会自毁）；③ App 以 <b>http</b> 方式在局域网内打开（https
            页面无法拉取 http 中继数据，会触发混合内容拦截）。
          </p>
          <div className="btn-row">
            <button className="btn" onClick={() => navigate('/')}>
              返回
            </button>
          </div>
        </>
      )}
    </div>
  )
}
