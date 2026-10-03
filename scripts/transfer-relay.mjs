#!/usr/bin/env node
/**
 * 局域网迁移中继（方案 A：扫码直传，零后端）。
 *
 * 为什么需要它：用户本地数据存在浏览器 localStorage，浏览器无法监听 TCP 端口，
 * 也不可能让手机直接读 PC 的 localStorage。所以由本机起一个一次性 HTTP 服务当中转：
 *   PC 端 App 把备份 POST 到这里 → 手机扫码打开 App 的 /receive 路由 → 手机再 GET 这里拉走数据。
 *
 * 二维码里只放「接收地址」，不放数据本身（二维码容量上限约 2.9KB，真实备份远超）。
 *
 * 运行：npm run relay  （或 node scripts/transfer-relay.mjs）
 * 环境变量：TRANSFER_PORT（默认 18080）、TRANSFER_TTL_MS（默认 5 分钟）
 *
 * 安全：绑定 0.0.0.0 仅用于局域网；数据存内存、一次性拉取后即删；无操作/拉取后自动退出。
 */
import http from 'node:http'
import os from 'node:os'
import { URL } from 'node:url'

const PORT = Number(process.env.TRANSFER_PORT || 18080)
const TTL_MS = Number(process.env.TRANSFER_TTL_MS || 5 * 60 * 1000)

/** 取第一个非内部的 IPv4 地址（局域网地址） */
function lanIp() {
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address
    }
  }
  return '127.0.0.1'
}

/** token -> { data: string, expires: number } */
const store = new Map()

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS })
  res.end(JSON.stringify(obj))
}

const IP = lanIp()
let shutdownTimer = setTimeout(() => {
  console.log('[transfer-relay] 超时（默认 5 分钟）未使用，自动退出。')
  process.exit(0)
}, TTL_MS)

const server = http.createServer((req, res) => {
  let u
  try {
    u = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  } catch {
    return json(res, 400, { error: 'bad url' })
  }

  // 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }

  // GET /info -> 告诉 PC 端 App 本机局域网地址（App 用它拼接收链接）
  if (req.method === 'GET' && u.pathname === '/info') {
    return json(res, 200, { ip: IP, port: PORT })
  }

  // POST /push?token=T -> PC 端 App 把备份 JSON 推过来
  if (req.method === 'POST' && u.pathname === '/push') {
    const token = u.searchParams.get('token')
    if (!token) return json(res, 400, { error: 'missing token' })
    let chunks = ''
    req.on('data', (c) => {
      chunks += c
      if (chunks.length > 50 * 1024 * 1024) {
        // 防滥用：单份备份上限 50MB（含图片 base64 也够用）
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!chunks) return json(res, 400, { error: 'empty body' })
      store.set(token, { data: chunks, expires: Date.now() + TTL_MS })
      console.log(
        `[transfer-relay] 已收到数据（token=${token.slice(0, 6)}…，共 ${chunks.length} 字节），等待手机拉取。`,
      )
      json(res, 200, { ok: true, bytes: chunks.length })
    })
    return
  }

  // GET /api/data?token=T -> 手机拉取，一次性：取走即删
  if (req.method === 'GET' && u.pathname === '/api/data') {
    const token = u.searchParams.get('token')
    const entry = token && store.get(token)
    if (!entry) return json(res, 404, { error: 'not found or already consumed' })
    store.delete(token)
    clearTimeout(shutdownTimer)
    shutdownTimer = setTimeout(() => {
      console.log('[transfer-relay] 数据已拉取，自动退出。')
      process.exit(0)
    }, 3000)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CORS })
    return res.end(entry.data)
  }

  // GET / -> 给人工排障用的状态页
  if (req.method === 'GET' && u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>偶来迁移中继</title></head>` +
        `<body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.7">` +
        `<h2>偶来小路 · 迁移中继</h2>` +
        `<p>局域网中继已启动。请在 <b>PC 端 App</b> 内点「扫码迁移到手机」生成二维码，` +
        `手机在<b>同一 WiFi</b> 下扫码即可把 PC 数据导入手机。</p>` +
        `<p>本机局域网地址：<code>http://${IP}:${PORT}</code></p>` +
        `<p class="muted">中继为一次性：手机成功拉取后 3 秒、或 5 分钟无操作后自动退出。</p>` +
        `</body></html>`,
    )
    return
  }

  json(res, 404, { error: 'not found' })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log('[transfer-relay] 迁移中继已启动')
  console.log(`  本机局域网地址: http://${IP}:${PORT}`)
  console.log('  PC 端 App 内点「扫码迁移到手机」会自动把数据推到这里。')
  console.log('  中继为一次性：手机成功拉取后 3 秒、或 5 分钟无操作后自动退出。')
})
