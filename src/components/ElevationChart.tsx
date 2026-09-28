import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, MarkLineComponent, MarkPointComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ElevSample, TrackPoint } from '../types'
import { cumulativeKm } from '../lib/geo'

echarts.use([LineChart, GridComponent, TooltipComponent, MarkLineComponent, MarkPointComponent, CanvasRenderer])

interface Props {
  points: TrackPoint[]
  /** 地形采样序列（有它就用它画，比途经点密得多） */
  samples?: ElevSample[]
  /** 生效里程（km）：把采样序列的横轴拉伸到实际里程，避免直线距离偏短 */
  totalKm?: number
  /** 需要在剖面上标注的看点：{名称, 沿线里程} */
  marks?: { name: string; atKm: number }[]
  height?: number
}

export function ElevationChart({ points, samples, totalKm, marks = [], height = 240 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts>()

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chartRef.current = chart
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = undefined
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    // 采样序列优先：它比途经点密，剖面才画得出起伏
    let src: { lng: number; lat: number; ele?: number }[] =
      samples && samples.length >= 2
        ? samples.map(([lng, lat, ele]) => ({ lng, lat, ele }))
        : []
    if (src.length < 2) {
      src = points.filter(
        (p) => Number.isFinite(p.lng) && Number.isFinite(p.lat) && typeof p.ele === 'number',
      )
    }
    const withEle = src.filter((p) => typeof p.ele === 'number')
    if (withEle.length < 2) {
      chart.clear()
      chart.setOption({
        title: {
          text: '暂缺海拔数据',
          subtext: '在管理后台给途经点补上「海拔」即可生成剖面图',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#94a3b8', fontSize: 14, fontWeight: 'normal' },
          subtextStyle: { color: '#b6c0cc', fontSize: 12 },
        },
      })
      return
    }
    const cum = cumulativeKm(withEle)
    // 采样点走的是直线/圆周，累计距离比实际里程短，按比例拉伸到生效里程
    const span = cum[cum.length - 1] || 0
    const stretch = totalKm && totalKm > 0 && span > 0 ? totalKm / span : 1
    const data = withEle.map((p, i) => [Number((cum[i] * stretch).toFixed(2)), p.ele as number])
    chart.setOption(
      {
        animationDuration: 300,
        grid: { left: 48, right: 16, top: 24, bottom: 34 },
        tooltip: {
          trigger: 'axis',
          formatter: (params: any) => {
            const p = params[0]
            return `沿线 ${p.value[0]} km<br/>海拔 ${p.value[1]} m`
          },
        },
        xAxis: {
          type: 'value',
          name: 'km',
          nameTextStyle: { color: '#94a3b8' },
          axisLine: { lineStyle: { color: '#d8dee9' } },
          axisLabel: { color: '#7b8794' },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          name: 'm',
          nameTextStyle: { color: '#94a3b8' },
          axisLine: { show: false },
          axisLabel: { color: '#7b8794' },
          splitLine: { lineStyle: { color: '#eef1f5' } },
        },
        series: [
          {
            type: 'line',
            smooth: 0.2,
            showSymbol: false,
            data,
            lineStyle: { color: '#2f7d4f', width: 2 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(47,125,79,0.28)' },
                { offset: 1, color: 'rgba(47,125,79,0.02)' },
              ]),
            },
            markLine:
              marks.length > 0
                ? {
                    silent: true,
                    symbol: 'none',
                    label: { formatter: '{b}', color: '#64748b', fontSize: 11, position: 'insideEndTop' },
                    lineStyle: { color: '#ea580c', type: 'dashed', width: 1 },
                    data: marks.map((m) => ({ xAxis: Number(m.atKm.toFixed(2)), name: m.name })),
                  }
                : undefined,
          },
        ],
      },
      true,
    )
  }, [points, samples, totalKm, marks])

  return <div ref={ref} style={{ width: '100%', height }} />
}
