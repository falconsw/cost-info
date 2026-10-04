// Cost Info: what this session has cost so far, and the tokens it took, live.
//
// The figure is the one /cost shows ($.session.usage().cost.usd): every priced
// API response this session, subagents included. On a Pro or Max plan it is
// what the same usage would have cost on the API. Tokens are every model
// request's four counts summed (input, cache writes, cache reads, output),
// subagents included, counted from when the mod loaded into the session.

import { atom, read, update } from 'claude-code'
import type { BoxProps, ElementConstructor, EngineInterface, ModelUsage, Register, TextProps } from 'claude-code'

import type { Totals } from '../types'

const EMPTY: Totals = {
  session: null,
  total: 0,
  turnBase: 0,
  last: null,
  turns: 0,
  priciest: 0,
  warned: false,
  tokens: 0,
  turnTokens: 0,
  isWorking: false,
}
// Held by the host, so the totals survive a hot reload of this file.
const meter = atom({ plugin: 'cost-info', key: 'meter' } as const, EMPTY)
// VS Code draws no band above the prompt, so there the meter lives in this pane.
const PANE = 'cost-info'
const TITLE = 'Cost'
const COMMAND = 'spend'
const NOTHING = 'Nothing spent yet this session.'

type Kit = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

const money = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`

const tok = (n: number): string =>
  n < 1000 ? `${n} tok` : n < 999_500 ? `${(n / 1000).toFixed(n < 9_950 ? 1 : 0)}k tok` : `${(n / 1_000_000).toFixed(2)}M tok`

const formatCost = (usd: number, tokens = 0): string =>
  tokens > 0 ? `This session: ${money(usd)} · ${tok(tokens)}` : `This session: ${money(usd)}`

const tokensOf = (u: ModelUsage): number =>
  u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

export const register: Register = (on, options) => {
  const budget = typeof options.budget === 'number' ? options.budget : 0

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { startedAt, cost } = await $.session.usage()
    const m = await update($, meter, m => fresh(m, startedAt)) // a new session starts from zero, a reload keeps its totals
    await $.command.register({ name: COMMAND, description: 'Show what this session has cost, turn by turn' })
    if (cost !== undefined) {
      $.ui.status(formatCost(cost.usd, m.tokens))
    }

    return result
  })

  // Fires whenever the status line's figures move, mid-turn too, so the meter keeps up live.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('cost') && e.cost !== undefined) {
      const m = await spend($, (await $.session.usage()).startedAt, e.cost.usd, budget)
      $.ui.status(formatCost(m.total, m.tokens))
    }

    return result
  })

  on('turn.start', async ($, e, next) => {
    await update($, meter, m => ({ ...m, turnTokens: 0, isWorking: true }))

    return next(e)
  })

  // One model request, the main loop's or a subagent's: its tokens count once its response is in.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (result.usage !== null) {
      const n = tokensOf(result.usage)
      const m = await update($, meter, m => ({
        ...m,
        tokens: m.tokens + n,
        turnTokens: m.isWorking ? m.turnTokens + n : m.turnTokens,
      }))
      $.ui.status(formatCost(m.total, m.tokens))
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const { startedAt, cost } = await $.session.usage()
      const m = await spend($, startedAt, cost?.usd, budget, m => {
        const last = m.total - m.turnBase

        return {
          ...m,
          turnBase: m.total,
          last,
          turns: m.turns + 1,
          priciest: Math.max(m.priciest, last),
          isWorking: false,
        }
      })
      $.ui.status(formatCost(m.total, m.tokens))
    }

    return result
  })

  on('session.attach', { surface: 'vscode' }, async ($, e, next) => {
    const result = await next(e)
    void $.ui.open({ id: PANE, title: TITLE })

    return result
  })

  on('command.run', { command: COMMAND }, async $ => {
    const m = await read($, meter)
    if ((await $.session.surfaces()).includes('vscode')) {
      await $.ui.open({ id: PANE, title: TITLE }) // asked for, so it is placed at any width
    }

    return { text: report(m, budget) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, meter)
    if (e.props.hasSurvey || m.total === 0) {
      return next(e)
    }

    return band($.ui.resolve(e), m, budget, e.props.bodyColumns)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const m = await read($, meter)
    const kit = $.ui.resolve(e)
    if (m.total === 0) {
      return <kit.Text dimColor>{NOTHING}</kit.Text>
    }

    return band(kit, m, budget, e.props.bodyColumns)
  })
}

// The stored totals, or empty ones if they belong to an earlier session.
const fresh = (m: Totals, startedAt: number): Totals =>
  m.session === startedAt ? { ...EMPTY, ...m } : { ...EMPTY, session: startedAt }

// Moves the session's cost to `usd` (kept where the host has no ledger) and applies `then`,
// warning once when the cost passes the budget.
const spend = async (
  $: EngineInterface,
  startedAt: number,
  usd: number | undefined,
  budget: number,
  then: (m: Totals) => Totals = m => m,
): Promise<Totals> => {
  let isCrossed = false
  const m = await update($, meter, value => {
    const m = fresh(value, startedAt)
    const total = usd ?? m.total
    const isOver = budget > 0 && total >= budget
    isCrossed = isOver && !m.warned

    return then({ ...m, total, turnBase: Math.min(m.turnBase, total), warned: m.warned || isOver })
  })
  if (isCrossed) {
    await $.ui.toast(`Cost Info: this session passed your ${money(budget)} budget`)
  }

  return m
}

const band = ({ Box, Text }: Kit, m: Totals, budget: number, columns: number) => {
  const used = budget > 0 ? m.total / budget : 0
  const color = budget === 0 ? undefined : used < 0.5 ? 'green' : used < 1 ? 'yellow' : 'red'
  const turnTokens = m.turnTokens > 0 ? ` · ${tok(m.turnTokens)}` : ''
  const turn = m.isWorking
    ? `   this turn ${money(m.total - m.turnBase)}${turnTokens}`
    : m.last !== null
      ? `   last turn ${money(m.last)}${turnTokens} · ${m.turns} ${m.turns === 1 ? 'turn' : 'turns'}`
      : null

  return (
    <Box flexDirection="row" paddingX={1}>
      <Text color={color} bold>
        {money(m.total)}
      </Text>
      {budget > 0 && <Text dimColor>{` / ${money(budget)} budget`}</Text>}
      {m.tokens > 0 && <Text dimColor>{` · ${tok(m.tokens)}`}</Text>}
      {columns >= 80 && turn !== null && <Text dimColor>{turn}</Text>}
    </Box>
  )
}

const report = (m: Totals, budget: number): string => {
  if (m.total === 0) {
    return NOTHING
  }
  const lines = [`This session: ${money(m.total)}`]
  if (m.tokens > 0) {
    lines.push(`  Tokens        ${tok(m.tokens)}`)
  }
  if (m.turns > 0) {
    lines.push(`  Turns         ${m.turns}`)
    lines.push(`  Per turn      ${money(m.total / m.turns)} on average`)
    lines.push(`  Priciest turn ${money(m.priciest)}`)
  }
  if (budget > 0) {
    lines.push(`  Budget        ${money(budget)} (${Math.round((m.total / budget) * 100)}% used)`)
  }

  return lines.join('\n')
}
