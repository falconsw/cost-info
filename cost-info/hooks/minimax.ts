// MiniMax M Plan: the plan's own 5-hour and weekly windows.
//
// Claude Code reports the windows of its own plan, but a session that talks to
// MiniMax gets none: those come from MiniMax's API instead. The endpoint
// answers the share left in each window, so the used share is a hundred less
// what is left.

import type { Limit } from '../types'

// The endpoint, on whichever MiniMax host the session's base URL names.
export const PATH = '/v1/coding_plan/remains'

// What the endpoint answers: a window per model the plan covers.
type Remains = {
  model_remains?: {
    model_name?: string
    // The share of the 5-hour window left, and the share of the weekly one.
    current_interval_remaining_percent?: number
    current_weekly_remaining_percent?: number
    // How long each window has left, in milliseconds.
    remains_time?: number
    weekly_remains_time?: number
    // When each window ends, in milliseconds since the epoch.
    end_time?: number
    weekly_end_time?: number
  }[]
}

// The host of a MiniMax base URL, or null when the session talks to someone else.
export const minimaxOrigin = (base: string | undefined): string | null => {
  if (base === undefined) {
    return null
  }
  try {
    const url = new URL(base)

    return url.hostname.includes('minimax') ? url.origin : null
  } catch {
    return null
  }
}

// The used share of a window: a hundred less the share left, as a whole percent.
const used = (left: number | undefined): number | null =>
  typeof left === 'number' ? Math.max(0, Math.min(100, Math.round(100 - left))) : null

// When a window ends: the countdown it answers, or the end it names.
const endsAt = (remains: number | undefined, end: number | undefined, now: number): number | null => {
  if (typeof remains === 'number' && remains > 0) {
    return now + remains
  }

  return typeof end === 'number' ? end : null
}

// The soonest of the windows' ends.
const soonest = (ends: (number | null)[]): number | null => {
  const known = ends.filter((e): e is number => e !== null)

  return known.length > 0 ? Math.min(...known) : null
}

// The plan's windows out of what the endpoint answered, or null when it said
// nothing usable.
export const limitsOf = (text: string, now: number): Limit[] | null => {
  let body: Remains
  try {
    body = JSON.parse(text) as Remains
  } catch {
    return null
  }
  const windows = body.model_remains ?? []
  if (windows.length === 0) {
    return null
  }
  const five = windows.map(w => used(w.current_interval_remaining_percent)).filter(p => p !== null)
  const week = windows.map(w => used(w.current_weekly_remaining_percent)).filter(p => p !== null)
  const limits: Limit[] = []
  // A plan may cover several models, each with its own windows: the used share
  // shown is the fullest of them, and the reset the soonest of them.
  if (five.length > 0) {
    limits.push({
      label: '5h',
      percent: Math.max(...five),
      resetsAt: soonest(windows.map(w => endsAt(w.remains_time, w.end_time, now))),
    })
  }
  if (week.length > 0) {
    limits.push({
      label: 'wk',
      percent: Math.max(...week),
      resetsAt: soonest(windows.map(w => endsAt(w.weekly_remains_time, w.weekly_end_time, now))),
    })
  }

  return limits.length > 0 ? limits : null
}
