import { useCallback, useState } from 'react'

/**
 * 地图图层开关（当前只有「住宿标」一项）。
 *
 * 为什么存在 localStorage 里，而不是详情页内的 useState：
 * 详情页底部有「上一条 / 下一条」翻页，住宿密的路线（OSM 数据动辄几十家）会糊住轨迹，
 * 用户一旦收起，翻到下一条时理应保持收起 —— 页面级 state 每次重新挂载都会重置回「显示」。
 *
 * 只落本机，不进 routes 备份（清数据即重置，符合预期），与 stayIntro 的覆盖层同构。
 */
const K = 'jejuolle100k.mapLayers'

interface MapLayers {
  /** 路线地图是否画住宿标。默认画（与加开关之前的行为一致），收起只看轨迹 */
  showStays: boolean
}

const DEFAULTS: MapLayers = { showStays: true }

function read(): MapLayers {
  try {
    const raw = localStorage.getItem(K)
    if (!raw) return { ...DEFAULTS }
    const v = JSON.parse(raw) as Partial<MapLayers> | null
    if (!v || typeof v !== 'object') return { ...DEFAULTS }
    return { showStays: typeof v.showStays === 'boolean' ? v.showStays : DEFAULTS.showStays }
  } catch {
    return { ...DEFAULTS }
  }
}

function write(v: MapLayers): void {
  try {
    localStorage.setItem(K, JSON.stringify(v))
  } catch (err) {
    console.error('[mapLayers] 写入失败', err)
  }
}

/** 路线地图上「是否展示住宿标」的开关，跨刷新与跨路线保留 */
export function useShowStays() {
  const [showStays, set] = useState<boolean>(() => read().showStays)
  const setShowStays = useCallback((on: boolean) => {
    write({ showStays: on })
    set(on)
  }, [])
  return [showStays, setShowStays] as const
}
