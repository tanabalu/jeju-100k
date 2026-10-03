import { useCallback, useEffect, useState } from 'react'

/**
 * 酒店介绍的「用户改写」覆盖层。
 *
 * 为什么独立成一个 localStorage 表，而不是直接改 route.hotels[].intro：
 * - 住宿池真源是 src/data/stays.json，运行时由 DataContext.mergeStays 按 id 整条替换
 *   route.hotels 里「id 属于 bundle」的条目。直接在 route.hotels 上改的酒店介绍，
 *   下次刷新会被真源版本盖掉。
 * - 改成「按 hotel.id 存的覆盖表」后，显示层读 `override[id] ?? hotel.intro`，
 *   无论这家酒店来自 bundle 还是用户手填，改写都能跨刷新保留。
 *
 * 与本项目「研发期不做历史数据迁移」不冲突：这是全新字段，不存在老数据要兼容，
 * 且只落本机 localStorage，不进 routes 备份（清数据即重置，符合预期）。
 */
const K = 'jejuolle100k.stayIntros'

type IntroMap = Record<string, string>

function readMap(): IntroMap {
  try {
    const raw = localStorage.getItem(K)
    if (!raw) return {}
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as IntroMap) : {}
  } catch {
    return {}
  }
}

function writeMap(m: IntroMap): void {
  try {
    localStorage.setItem(K, JSON.stringify(m))
  } catch (err) {
    console.error('[stayIntro] 写入失败', err)
  }
}

/** 读取某酒店的改写介绍（未改写返回 undefined，界面回落到 hotel.intro） */
export function getStayIntro(id: string): string | undefined {
  const v = readMap()[id]
  return typeof v === 'string' ? v : undefined
}

/** 保存某酒店的改写介绍；传入空串等同清除覆盖（回落默认） */
export function setStayIntro(id: string, text: string): void {
  const m = readMap()
  if (text.trim() === '') delete m[id]
  else m[id] = text
  writeMap(m)
}

/** 清除某酒店的改写介绍，回落到打包默认（hotel.intro） */
export function resetStayIntro(id: string): void {
  const m = readMap()
  if (id in m) {
    delete m[id]
    writeMap(m)
  }
}

/**
 * 酒店介绍的读写 hook。
 * @param id 酒店 id
 * @param fallback 打包真源里的默认介绍（hotel.intro），未改写时回落到这里
 */
export function useStayIntro(id: string, fallback?: string) {
  const [override, setOverride] = useState<string | undefined>(() => getStayIntro(id))

  // id 变化（同一会话里理论上不会，但稳妥）时重新读一次覆盖层
  useEffect(() => {
    setOverride(getStayIntro(id))
  }, [id])

  const value = override ?? fallback ?? ''
  const isOverridden = override !== undefined

  const save = useCallback(
    (text: string) => {
      setStayIntro(id, text)
      setOverride(text.trim() === '' ? undefined : text)
    },
    [id],
  )

  const reset = useCallback(() => {
    resetStayIntro(id)
    setOverride(undefined)
  }, [id])

  return { value, isOverridden, save, reset }
}
