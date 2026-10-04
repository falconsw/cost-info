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
}

declare module 'claude-code' {
  interface PluginState {
    'cost-info': { meter: Totals }
  }
}
