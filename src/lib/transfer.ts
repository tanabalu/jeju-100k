import { toDataURL } from 'qrcode'
import { exportBackup } from './storage'

/** 迁移中继默认端口（与 scripts/transfer-relay.mjs 一致；可用 VITE_TRANSFER_PORT 覆盖） */
const RELAY_PORT = Number(
  (import.meta.env as Record<string, string | undefined>).VITE_TRANSFER_PORT || 18080,
)

export interface TransferResult {
  /** 二维码图片（dataURL），直接丢进 <img src> */
  qrDataUrl: string
  /** 手机端接收地址：<app-base>#/receive?src=<中继数据地址> */
  receiveUrl: string
}

/**
 * 检测 PC 端是否已运行迁移中继（npm run relay）。
 * 返回中继所在机的局域网地址，否则返回 null。
 */
export async function pingRelay(): Promise<{ ip: string; port: number } | null> {
  try {
    const res = await fetch(`http://localhost:${RELAY_PORT}/info`)
    if (!res.ok) return null
    return (await res.json()) as { ip: string; port: number }
  } catch {
    // 连不上 = 中继没起（localhost 无监听会立刻 connection refused）
    return null
  }
}

function makeToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 把当前访问地址换成手机可达的局域网地址：
 * 若 PC 端以 localhost / 127.0.0.1 打开 App，则把 host 换成中继机的局域网 IP，
 * 否则手机扫到的 localhost 会是它「自己」的回环。
 */
function appReceiveBase(relayIp: string): string {
  const base = window.location.href.split('#')[0]
  try {
    const cur = new URL(base)
    if (cur.hostname === 'localhost' || cur.hostname === '127.0.0.1') {
      const port = cur.port || (cur.protocol === 'https:' ? '443' : '80')
      return `${cur.protocol}//${relayIp}:${port}/`
    }
    return base
  } catch {
    return base
  }
}

/**
 * 生成「扫码迁移到手机」二维码：
 *  1) 把本机备份推到本地中继；
 *  2) 拼出手机端接收地址（App 的 /receive 路由 + 中继数据地址）；
 *  3) 渲染二维码。
 *
 * ⚠️ 仅迁移 exportBackup 覆盖的内容（routes / plans / settings）。
 * 用户上传的图片在 IndexedDB、按 ImageRef{kind:'local'} 引用，换设备后 key 失效 → 图片不会跟着过来，
 * 这是已知缺口，接收端会回落成占位图。要带图迁移需另做 base64 打包，本期未做。
 */
export async function generateTransferQr(): Promise<TransferResult> {
  const info = await pingRelay()
  if (!info) {
    throw new Error('未检测到迁移中继。请先在 PC 端终端运行 `npm run relay` 启动中继服务，再回来点此按钮。')
  }
  const token = makeToken()
  const data = exportBackup()
  const pushRes = await fetch(`http://localhost:${RELAY_PORT}/push?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data,
  })
  if (!pushRes.ok) {
    throw new Error('备份推送到中继失败，请重试或重启中继。')
  }
  const srcUrl = `http://${info.ip}:${info.port}/api/data?token=${token}`
  const receiveUrl = `${appReceiveBase(info.ip)}#/receive?src=${encodeURIComponent(srcUrl)}`
  const qrDataUrl = await toDataURL(receiveUrl, { margin: 2, width: 320 })
  return { qrDataUrl, receiveUrl }
}
