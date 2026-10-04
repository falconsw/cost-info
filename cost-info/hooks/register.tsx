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
// VS Code draws no prompt footer, so there the meter opens in a pane of its own.
const PANE = 'cost-info'
const TITLE = 'Cost'
const COMMAND = 'spend'
const NOTHING = 'Nothing spent yet this session.'
// Below this many columns the footer leaves the turn out.
const WIDE = 120

type Kit = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

// One run of the meter's text: a figure, drawn green, or the words around the figures.
type Piece = { text: string; isFigure?: boolean }

const money = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`

const tok = (n: number): string =>
  n < 1000 ? `${n} tok` : n < 999_500 ? `${(n / 1000).toFixed(n < 9_950 ? 1 : 0)}k tok` : `${(n / 1_000_000).toFixed(2)}M tok`

const tokensOf = (u: ModelUsage): number =>
  u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

// The session's cost and tokens, and the budget where one is shown.
const sessionOf = (m: Totals, budget = 0): Piece[] => [
  { text: 'session ' },
  { text: money(m.total), isFigure: true },
  ...(m.tokens > 0 ? [{ text: ' · ' }, { text: tok(m.tokens), isFigure: true }] : []),
  ...(budget > 0 ? [{ text: ` of ${money(budget)} budget` }] : []),
]

// The running turn while it works, the last one after; null before the first.
const turnOf = (m: Totals, withCount = false): Piece[] | null => {
  const cost = m.isWorking ? m.total - m.turnBase : m.last
  if (cost === null) {
    return null
  }

  return [
    { text: m.isWorking ? 'this turn ' : 'last turn ' },
    { text: money(cost), isFigure: true },
    ...(m.turnTokens > 0 ? [{ text: ' · ' }, { text: tok(m.turnTokens), isFigure: true }] : []),
    ...(withCount && !m.isWorking ? [{ text: ` · ${m.turns} ${m.turns === 1 ? 'turn' : 'turns'}` }] : []),
  ]
}

const draw = ({ Box, Text }: Kit, key: string, pieces: Piece[]) => (
  <Box key={key} flexDirection="row">
    {pieces.map(piece => (piece.isFigure ? <Text color="green">{piece.text}</Text> : <Text>{piece.text}</Text>))}
  </Box>
)

export const register: Register = (on, options) => {
  const budget = typeof options.budget === 'number' ? options.budget : 0

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { startedAt, cost } = await $.session.usage()
    await spend($, startedAt, cost?.usd, budget) // a new session starts from zero, a reload keeps its totals
    await $.command.register({ name: COMMAND, description: 'Show what this session has cost, turn by turn' })

    return result
  })

  // Fires whenever the status line's figures move, mid-turn too, so the meter keeps up live.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('cost') && e.cost !== undefined) {
      await spend($, (await $.session.usage()).startedAt, e.cost.usd, budget)
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
      await update($, meter, m => ({
        ...m,
        tokens: m.tokens + n,
        turnTokens: m.isWorking ? m.turnTokens + n : m.turnTokens,
      }))
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const { startedAt, cost } = await $.session.usage()
      await spend($, startedAt, cost?.usd, budget, m => {
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

  // Under the prompt, left of the engine's own mode labels, which stay as the engine drew them.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const modes = await next(e)
    const m = await read($, meter)
    if (m.total === 0 && m.tokens === 0) {
      return modes
    }
    const turn = (e.viewport?.columns ?? WIDE) >= WIDE ? turnOf(m) : null
    const pieces = turn === null ? sessionOf(m) : [...sessionOf(m), { text: ' | ' }, ...turn]
    const kit = $.ui.resolve(e)

    return (
      <kit.Box flexDirection="row">
        {draw(kit, 'meter', pieces)}
        {e.props.modes.length > 0 && <kit.Text>{'  '}</kit.Text>}
        {modes}
      </kit.Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const m = await read($, meter)
    const kit = $.ui.resolve(e)
    if (m.total === 0) {
      return <kit.Text>{NOTHING}</kit.Text>
    }
    const turn = turnOf(m, true)

    return (
      <kit.Box flexDirection="column" paddingX={1}>
        {draw(kit, 'session', sessionOf(m, budget))}
        {turn !== null && draw(kit, 'turn', turn)}
      </kit.Box>
    )
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
