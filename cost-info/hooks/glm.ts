// GLM Coding Plan (Z.ai): the plan's own 5-hour and weekly windows.
//
// Like MiniMax, a session that talks to Z.ai gets no windows from Claude Code:
// they come from Z.ai's API instead. The endpoint answers the share used in
// each window, and the plan's level (lite, pro, max).

import type { Limit } from '../types'

// The endpoint, on whichever Z.ai host the session's base URL names.
export const PATH = '/api/monitor/usage/quota/limit'

// What the endpoint answers: a quota per window, and the plan's level.
type Quota = {
  data?: {
    level?: string
    limits?: {
      // TOKENS_LIMIT or CREDIT_LIMIT for the model's windows; TIME_LIMIT counts MCP tool calls.
      type?: string
      // The window's length: `number` of `unit`s (3 hours, 6 weeks).
      unit?: number
      number?: number
      // The share of the window used, as a whole percent.
      percentage?: number
      // When the window resets, in milliseconds since the epoch.
      nextResetTime?: number
    }[]
  }
}

// The host of a Z.ai base URL (api.z.ai, or open.bigmodel.cn in China), or null
// when the session talks to someone else.
export const glmOrigin = (base: string | undefined): string | null => {
  if (base === undefined) {
    return null
  }
  try {
    const url = new URL(base)
    const host = url.hostname

    return host === 'z.ai' || host.endsWith('.z.ai') || host.endsWith('bigmodel.cn') ? url.origin : null
  } catch {
    return null
  }
}

// A window's label out of its length, or null for a unit the meter does not know.
const labelOf = (unit: number | undefined, n: number | undefined): string | null => {
  const count = typeof n === 'number' && n > 0 ? n : 1
  switch (unit) {
    case 3:
      return `${count}h`
    case 6:
      return count === 1 ? 'wk' : `${count}wk`
    default:
      return null
  }
}

// The plan's name, as Z.ai sells it: GLM Coding Lite, Pro, Max.
export const planOf = (text: string): string => {
  try {
    const level = (JSON.parse(text) as Quota).data?.level
    if (typeof level === 'string' && level !== '') {
      return `GLM Coding ${level[0].toUpperCase()}${level.slice(1)}`
    }
  } catch {}

  return 'GLM Coding Plan'
}

// The plan's windows out of what the endpoint answered, or null when it said
// nothing usable.
export const limitsOf = (text: string): Limit[] | null => {
  let body: Quota
  try {
    body = JSON.parse(text) as Quota
  } catch {
    return null
  }
  const limits: Limit[] = []
  for (const q of body.data?.limits ?? []) {
    const label = labelOf(q.unit, q.number)
    if (q.type === 'TIME_LIMIT' || label === null || typeof q.percentage !== 'number') {
      continue
    }
    limits.push({
      label,
      percent: Math.max(0, Math.min(100, Math.round(q.percentage))),
      resetsAt: typeof q.nextResetTime === 'number' ? q.nextResetTime : null,
    })
  }
  return limits.length > 0 ? limits : null
}
