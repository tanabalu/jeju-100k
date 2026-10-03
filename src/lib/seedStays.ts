// 住宿 seed 派生模块（不再内联任何住宿数据）。
//
// 唯一真源：src/data/stays.json（OSM / TourAPI / Kakao / 人工核对 合并产物）。
// 本文件只在模块加载时按 routeTowns 把真源里的住宿归集到每条路线，
// 与 src/store/DataContext.tsx 的 mergeStays 行为一致。
//
// 因为数据直接 import 自真源，改完 src/data/stays.json 后无需重跑任何脚本 ——
// 重跑爬虫/生成脚本更新 stays.json，构建时本文件自动拿到最新数据。
import staysData from '../data/stays.json'
import type { Hotel } from '../types'

type RawTown = { ko: string; hotels?: Hotel[] }
type RawStays = { towns: RawTown[]; routeTowns: Record<string, string[]> }

const raw = staysData as unknown as RawStays
const townsByKo: Record<string, Hotel[]> = Object.fromEntries(
  raw.towns.map((t) => [t.ko, t.hotels ?? []]),
)

export const SEED_STAYS: Record<string, Hotel[]> = Object.fromEntries(
  Object.entries(raw.routeTowns).map(([code, koList]) => {
    const seen = new Set<string>()
    const arr: Hotel[] = []
    for (const ko of koList) {
      for (const h of townsByKo[ko] ?? []) {
        if (h.id && !seen.has(h.id)) {
          seen.add(h.id)
          arr.push(h)
        }
      }
    }
    return [code, arr]
  }),
)
