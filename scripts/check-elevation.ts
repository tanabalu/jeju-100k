/** 本地校验：27 条预置路线的爬升/下降是否算得出来（不依赖浏览器） */
import { buildSeedRoutes } from '../src/lib/seed'
import { computeMetrics } from '../src/lib/geo'

const routes = buildSeedRoutes()
let missing = 0
let totalGain = 0

for (const r of routes) {
  const m = computeMetrics(r)
  if (m.gainM == null) missing++
  totalGain += m.gainM ?? 0
  console.log(
    `${(r.code ?? '?').padStart(5)}  ${String(m.distanceKm).padStart(5)} km  ` +
      `爬升 ${String(m.gainM ?? '—').padStart(4)} m  下降 ${String(m.lossM ?? '—').padStart(4)} m  ` +
      `最高 ${String(m.highestM ?? '—').padStart(4)} m  ${m.gainSource}/${m.elevationBasis ?? '-'}`,
  )
}

console.log(`\n路线 ${routes.length} 条，爬升缺失 ${missing} 条，爬升合计 ${totalGain} m`)
