export type Limit = { label: string; percent: number; resetsAt: number | null }

export type Totals = {
  session: number | null
  total: number
  turnBase: number
  last: number | null
  turns: number
  turnsCost: number
  priciest: number
  warned: boolean
  tokens: number
  turnTokens: number
  isWorking: boolean
  limits: Limit[]
  // The windows of a plan read from its provider (MiniMax, Z.ai), and the plan's name.
  provider: Limit[]
  plan: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'cost-info': { meter: Totals }
  }
}
