/**
 * 路线类型（徒步 / 越野跑 / 轻装快穿……）相关常量与工具，集中放这一个文件。
 *
 * 设计意图：枚举、中文标签、取标签的函数都收口在这里，
 * 后续新增或调整路线类型时，只改本文件即可保证全站逻辑一起生效，
 * 不必在 types / BasicForm / useActivePlan 等多处同步修改。
 */

/** 路线类型枚举 */
export type RouteKind = 'hike'

/** 路线类型 → 中文标签 */
export const ROUTE_KIND_LABEL: Record<RouteKind, string> = {
  hike: '徒步',
}

/** 取路线类型的中文标签 */
export function routeKindLabel(kind: RouteKind): string {
  return ROUTE_KIND_LABEL[kind]
}
