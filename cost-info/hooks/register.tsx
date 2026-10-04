// Cost Info: what this session has cost so far, live.
//
// The figure is the one /cost shows ($.session.usage().cost.usd): every priced
// API response this session, subagents included. On a Pro or Max plan it is
// what the same usage would have cost on the API.

import { atom, read, update } from 'claude-code'
import type { BoxProps, ElementConstructor, EngineInterface, Register, TextProps } from 'claude-code'

import type { Totals } from '../types'

const EMPTY: Totals = { session: null, total: 0, turnBase: 0, last: null, turns: 0, priciest: 0, warned: false }
// Held by the host, so the totals survive a hot reload of this file.
const meter = atom({ plugin: 'cost-info', key: 'meter' } as const, EMPTY)
// VS Code draws no band above the prompt, so there the meter lives in this pane.
const PANE = 'cost-info'
const TITLE = 'Cost'
const COMMAND = 'spend'
const NOTHING = 'Nothing spent yet this session.'

type Kit = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

const money = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`

const formatCost = (usd: number): string => `This session: ${money(usd)}`

export const register: Register = (on, options) => {
  const budget = typeof options.budget === 'number' ? options.budget : 0

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { startedAt, cost } = await $.session.usage()
    const m = await load($, startedAt) // a new session starts from zero, a reload keeps its totals
    await update($, meter, () => m)
    await $.command.register({ name: COMMAND, description: 'Show what this session has cost, turn by turn' })
    if (cost !== undefined) {
      $.ui.status(formatCost(cost.usd))
    }

    return result
  })

  // Fires whenever the status line's figures move, mid-turn too, so the meter keeps up live.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('cost') && e.cost !== undefined) {
      const m = await spend($, await load($, (await $.session.usage()).startedAt), e.cost.usd, budget)
      await update($, meter, () => m)
      $.ui.status(formatCost(m.total))
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const { startedAt, cost } = await $.session.usage()
    if (e.agentId === undefined && cost !== undefined) {
      const m = await spend($, await load($, startedAt), cost.usd, budget)
      const last = m.total - m.turnBase
      await update($, meter, () => ({
        ...m,
        turnBase: m.total,
        last,
        turns: m.turns + 1,
        priciest: Math.max(m.priciest, last),
      }))
      $.ui.status(formatCost(m.total))
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
const load = async ($: EngineInterface, startedAt: number): Promise<Totals> => {
  const m = await read($, meter)

  return m.session === startedAt ? m : { ...EMPTY, session: startedAt }
}

// The totals with the session's cost now at `usd`, warning once when it passes the budget.
const spend = async ($: EngineInterface, m: Totals, usd: number, budget: number): Promise<Totals> => {
  const next = { ...m, total: usd, turnBase: Math.min(m.turnBase, usd) }
  if (budget > 0 && usd >= budget && !m.warned) {
    next.warned = true
    await $.ui.toast(`Cost Info: this session passed your ${money(budget)} budget`)
  }

  return next
}

const band = ({ Box, Text }: Kit, m: Totals, budget: number, columns: number) => {
  const used = budget > 0 ? m.total / budget : 0
  const color = budget === 0 ? undefined : used < 0.5 ? 'green' : used < 1 ? 'yellow' : 'red'

  return (
    <Box flexDirection="row" paddingX={1}>
      <Text color={color} bold>
        {money(m.total)}
      </Text>
      {budget > 0 && <Text dimColor>{` / ${money(budget)} budget`}</Text>}
      {columns >= 60 && m.last !== null && (
        <Text dimColor>{`   last turn ${money(m.last)} · ${m.turns} ${m.turns === 1 ? 'turn' : 'turns'}`}</Text>
      )}
    </Box>
  )
}

const report = (m: Totals, budget: number): string => {
  if (m.total === 0) {
    return NOTHING
  }
  const lines = [formatCost(m.total)]
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
