import type { ReactNode } from 'react'
import type { Route } from '../../types'
import { computeMetrics, formatKm } from '../../lib/geo'
import { estimateHours, formatHours } from '../../lib/dayPlan'
import { formatDurationRange, officialDuration } from '../../lib/olleDurations'
import { routeKindLabel } from '../../lib/routeKind'
import { Thumb } from '../../components/Thumb'
import styles from './BasicForm.module.less'

interface Props {
  route: Route
}

export function BasicForm({ route }: Props) {
  const m = computeMetrics(route)
  const stars = '★'.repeat(Math.max(1, Math.min(5, route.difficulty)))
  const distance =
    route.manualDistanceKm != null
      ? `${route.manualDistanceKm} km`
      : `${formatKm(m.straightKm * 1.2)} km（按直线 ×1.2 估算）`
  const gain =
    route.manualGainM != null
      ? `${route.manualGainM} m`
      : m.gainM == null
      ? '无海拔数据'
      : `${m.gainM} m${m.gainSource === 'profile' ? '（来自地形采样）' : ''}`

  // 耗时口径与详情页一致：官方 App 录入值优先，无官方数据回退公式估算
  const official = officialDuration(route.code)
  const duration = official
    ? `${formatDurationRange(official)}（官方口径${official.officialKm ? ` · 官方里程 ${official.officialKm} km` : ''}）`
    : m.distanceKm > 0
      ? `约 ${formatHours(estimateHours(m.distanceKm, m.gainM))}（按里程 / 爬升估算）`
      : '—'

  const coverRow: { label: string; value: ReactNode } = {
    label: '封面图',
    value: route.cover ? (
      <div className={`${styles['cover-preview']}`}>
        <Thumb image={route.cover} alt="封面图" radius={8} />
      </div>
    ) : (
      '—'
    ),
  }

  const rows: Array<{ label: string; value: ReactNode }> = [
    { label: '路线编号', value: route.code ?? '—' },
    { label: '地区', value: route.region || '—' },
    { label: '类型', value: routeKindLabel(route.kind) },
    { label: '难度', value: `${route.difficulty} 级（${stars}）` },
    { label: '预估耗时', value: duration },
    { label: '路面 / 地形', value: route.surface || '—' },
    { label: '最佳季节', value: route.bestSeason || '—' },
    { label: '标签', value: route.tags.length ? route.tags.join('、') : '—' },
    { label: '实际里程', value: distance },
    { label: '实际累计爬升', value: gain },
    coverRow,
  ]

  return (
    <div className={`${styles['info-view']}`}>
      <h3 className={`${styles['info-title']}`}>{route.name}</h3>
      <dl className={`${styles['info-list']}`}>
        {rows.map((r) => (
          <div className={`${styles['info-row']}`} key={r.label}>
            <dt className={`${styles['info-label']}`}>{r.label}</dt>
            <dd className={`${styles['info-value']}`}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
