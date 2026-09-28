/**
 * 腾讯地图 GL JS 加载器。
 *
 * 合规说明：底图只允许使用具备测绘资质的服务（腾讯/高德/百度/天地图），
 * 本项目默认使用腾讯位置服务。
 *
 * 两种模式：
 * 1) 代理模式（默认）：不携带 key，请求经由本地代理转发，Key 不落前端。仅本地预览环境可用。
 * 2) Key 模式：用户在腾讯位置服务开放平台自行申请后填入，SDK 地址携带该 key，
 *    可在任意部署环境使用。
 *
 * ⚠️ 本项目面向韩国济州岛（海外区域），海外底图覆盖取决于服务商数据，
 *    且海外场景不适用默认代理，因此实际使用时请以 Key 模式为准；
 *    拿不到可用底图时页面自动降级为路线示意图，不影响核心功能。
 */

declare global {
  interface Window {
    TMap?: any
    _TMapSecurityConfig?: { serviceHost: string }
    __TMAP_PROXY__?: string
  }
}

export type MapMode = 'proxy' | 'key' | 'unavailable'

let loadPromise: Promise<void> | null = null
let currentMode: MapMode | null = null

export function detectMode(key: string): MapMode {
  if (key && key.trim()) return 'key'
  const proxy = window.__TMAP_PROXY__ ?? ''
  // 占位符未被运行时替换 => 不在本地预览环境，代理不可用
  if (!proxy || proxy.includes('__WB_')) return 'unavailable'
  return 'proxy'
}

export function getMapMode(): MapMode | null {
  return currentMode
}

export function loadTMap(key: string): Promise<void> {
  const mode = detectMode(key)
  if (mode === 'unavailable') {
    return Promise.reject(new Error('MAP_UNAVAILABLE'))
  }
  if (window.TMap && currentMode === mode) return Promise.resolve()
  if (loadPromise && currentMode === mode) return loadPromise
  if (loadPromise && currentMode !== mode) {
    // key 变了需要刷新页面重新加载 SDK
    return Promise.reject(new Error('MAP_MODE_CHANGED'))
  }

  currentMode = mode
  loadPromise = new Promise<void>((resolve, reject) => {
    if (mode === 'proxy') {
      // 必须在 SDK script 之前设置，且不要再调用 TMap.setConfig()
      window._TMapSecurityConfig = {
        serviceHost: window.__TMAP_PROXY__ as string,
      }
    }
    const base = 'https://map.qq.com/api/gljs?v=1.exp'
    const src =
      mode === 'key' ? `${base}&key=${encodeURIComponent(key.trim())}&libraries=service` : `${base}&libraries=service`
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => {
      if (window.TMap) resolve()
      else reject(new Error('TMap SDK 已加载但全局对象缺失'))
    }
    script.onerror = () => reject(new Error('TMap SDK 加载失败，请检查网络或 Key'))
    document.head.appendChild(script)
  })
  return loadPromise
}

/** 判断错误信息是否代表「底图不可用」，用于降级到示意图 */
export function isMapUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('MAP_UNAVAILABLE') || msg.includes('加载失败')
}
