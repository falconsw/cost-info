import { describe, expect, test } from 'claude-code/testing'
import type { ModelUsage, On } from 'claude-code'

const usage = (usd: number) => ({
  value: { startedAt: 0, rateLimits: [], context: { tokens: 1, window: 200000, percent: 0 }, cost: { usd } },
})

// Hooks registered here run after the mod and stand for what Claude Code would answer.
const engine = (on: On) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))
}

const measure = (usd: number) => ({
  context: { window: 200000 },
  rateLimits: [],
  cost: { usd },
  changed: ['cost' as const],
})

// Runs one model request through the chain and waits for its response.
const step = async ($: any, input: { turnId: string; index: number; agentId?: string }) => {
  const stream = $.turn.step({ model: 'claude-opus-5-5', messageCount: 1, ...input })
  for await (const _ of stream) {
  }

  return stream.result
}

const tokens = (input: number, output: number, read = 0, write = 0): ModelUsage => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
})

const FOOTER = {
  plugin: 'cost-info',
  component: 'SessionMode',
  props: { modes: [] },
  viewport: { columns: 160, rows: 40 },
} as const

const PANE = {
  plugin: 'cost-info',
  surface: 'vscode',
  component: 'Pane',
  requestId: 'cost-info',
  props: { title: 'Cost', isFocused: false, bodyColumns: 80, placement: 'dock' },
} as const

// What the Box keyed `key` shows, or '' while it is not drawn.
const shown = async (ui: any, key: string): Promise<string> => (await ui.find({ key }))?.text ?? ''

describe('cost-info', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`the footer shows the cost, its figures green and its words uncolored (${surface})`, async ($, on) => {
      let usd = 0.0042

      engine(on)
      on('session.usage', () => usage(usd))

      await $.session.start({ cwd: '/work', surface, isInteractive: true } as any)
      const ui = await $.ui.mount({ ...FOOTER, surface } as any)
      expect(await shown(ui, 'meter')).toBe('◉ $0.0042')
      expect((await ui.find({ type: 'Text', text: '$0.0042' }))?.props.color).toBe('green')
      expect((await ui.find({ type: 'Text', text: '◉ ' }))?.props.color).toBeUndefined()

      usd = 1.237
      await $.session.measure(measure(usd))
      expect(await shown(ui, 'meter')).toBe('◉ $1.24')
      await ui.unmount()
    })
  }

  test('draws nothing of its own until something is spent, and ignores measurements where the cost did not move', async ($, on) => {
    engine(on)
    on('session.usage', () => usage(0))

    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' } as any)
    expect(await ui.find({ key: 'meter' })).toBeUndefined()

    await $.session.measure({
      context: { window: 200000, tokens: 1000, percent: 1 },
      rateLimits: [],
      cost: { usd: 1 },
      changed: ['context'],
    })
    expect(await ui.find({ key: 'meter' })).toBeUndefined()
    await ui.unmount()
  })

  test("keeps the engine's own mode labels beside the meter", async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => usage(0.12))
    on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'focus' }))

    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal', props: { modes: ['focus'] } } as any)
    expect(await shown(ui, 'meter')).toBe('◉ $0.12')
    expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
    await ui.unmount()
  })

  test('the footer adds the last turn once one has ended, and leaves it out when narrow', async ($, on) => {
    let usd = 0

    engine(on)
    on('session.usage', () => usage(usd))

    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' } as any)
    const narrow = await $.ui.mount({ ...FOOTER, surface: 'terminal', viewport: { columns: 90, rows: 40 } } as any)

    usd = 0.12
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(await shown(ui, 'meter')).toBe('◉ $0.12 | last turn $0.12')

    usd = 0.42
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(await shown(ui, 'meter')).toBe('◉ $0.42 | last turn $0.30')
    expect(await shown(narrow, 'meter')).toBe('◉ $0.42')
    await ui.unmount()
    await narrow.unmount()
  })

  test('loaded into a session that already spent, it counts turns from there', async ($, on) => {
    let usd = 10

    engine(on)
    on('session.usage', () => usage(usd))
    on('session.surfaces', () => ({ value: ['terminal'] }))

    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' } as any)

    usd = 10.12
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    usd = 10.2
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(await shown(ui, 'meter')).toBe('◉ $10.20 | last turn $0.08')

    const run = await $.command.run({ command: 'spend', args: '' } as any)
    expect(run.text).toContain('This session: $10.20')
    expect(run.text).toContain('Per turn      $0.10 on average')
    expect(run.text).toContain('Priciest turn $0.12')
    await ui.unmount()
  })

  test('warns once when the session passes the budget', { options: { budget: 1 } }, async ($, on) => {
    const toasts: string[] = []

    engine(on)
    on('session.usage', () => usage(0))
    on('ui.toast', ($, e) => {
      toasts.push(e.text)

      return { value: undefined }
    })

    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await $.session.measure(measure(0.6))
    expect(toasts).toEqual([])

    await $.session.measure(measure(1.1))
    await $.session.measure(measure(1.5))
    expect(toasts).toEqual(['Cost Info: this session passed your $1.00 budget'])
  })

  test('on VS Code the meter opens in a pane', async ($, on) => {
    const opened: string[] = []
    let usd = 0

    engine(on)
    on('session.usage', () => usage(usd))
    on('session.surfaces', () => ({ value: ['vscode'] }))
    on('ui.open', ($, e) => {
      opened.push(e.id)

      return { value: { isPlaced: true } }
    })

    await $.session.start({ surface: null, isInteractive: true, cwd: '/work' } as any)
    await $.session.attach({ surface: 'vscode', clientId: 'vscode:default' })
    expect(opened).toEqual(['cost-info'])

    const pane = await $.ui.mount(PANE as any)
    expect(await pane.find({ type: 'Text', text: /Nothing spent yet/ })).toBeDefined()

    usd = 0.42
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(await shown(pane, 'session')).toBe('◉ $0.42 of $5.00 budget')
    expect(await shown(pane, 'turn')).toBe('last turn $0.42 · 1 turn')
    expect((await pane.find({ type: 'Text', text: '$0.42' }))?.props.color).toBe('green')

    const run = await $.command.run({ command: 'spend', args: '' } as any)
    expect(run.text).toContain('This session: $0.42')
    expect(run.text).toContain('Turns         1')
    expect(opened).toEqual(['cost-info', 'cost-info'])
    await pane.unmount()
  })

  test('counts the tokens of the running turn and of the whole session', async ($, on) => {
    let usd = 0
    const responses: (ModelUsage | null)[] = [tokens(500, 1000, 8000, 500), tokens(1500, 500), null]

    engine(on)
    on('session.usage', () => usage(usd))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: responses.shift() ?? null } as any
    })

    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' } as any)

    await $.turn.start({ text: 'hi', turnId: 't1' })
    await step($, { turnId: 't1', index: 0 })
    expect(await shown(ui, 'meter')).toBe('◉ $0.0000 · 10k tkn | this turn $0.0000 · 10k tkn')

    usd = 0.05
    await $.session.measure(measure(usd))
    expect(await shown(ui, 'meter')).toBe('◉ $0.05 · 10k tkn | this turn $0.05 · 10k tkn')

    await step($, { turnId: 't1', index: 0, agentId: 'helper' }) // a subagent's request counts too
    await step($, { turnId: 't1', index: 1 }) // a request with no response adds nothing
    expect(await shown(ui, 'meter')).toBe('◉ $0.05 · 12k tkn | this turn $0.05 · 12k tkn')
    expect((await ui.find({ type: 'Text', text: '12k tkn' }))?.props.color).toBe('green')

    usd = 0.08
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, turnId: 't1' } as any)
    expect(await shown(ui, 'meter')).toBe('◉ $0.08 · 12k tkn | last turn $0.08 · 12k tkn')

    await $.turn.start({ text: 'more', turnId: 't2' })
    expect(await shown(ui, 'meter')).toBe('◉ $0.08 · 12k tkn | this turn $0.0000')

    const run = await $.command.run({ command: 'spend', args: '' } as any)
    expect(run.text).toContain('Tokens        12k tkn')
    await ui.unmount()
  })
  test('on a plan with rate limits the footer shows the used share instead of dollars', async ($, on) => {
    const resetsAt = Math.floor(Date.now() / 1000) + 3 * 3600
    const limits = [
      { kind: 'five_hour', percentUsed: 37, resetsAt: new Date(resetsAt * 1000).toISOString() }, // the shape Claude Code reports
      { type: 'seven_day', utilization: 0.12, resetsAt: resetsAt + 86400 },
    ]

    engine(on)
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: limits, context: { tokens: 1, window: 200000, percent: 0 }, cost: { usd: 0.5 } } }))
    on('session.surfaces', () => ({ value: ['terminal'] }))

    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' } as any)
    expect(await shown(ui, 'meter')).toBe('◉ 5h %37 ↻3h 0m | 7d %12 ↻1d 3h')
    expect((await ui.find({ type: 'Text', text: '%37' }))?.props.color).toBe('green')

    const run = await $.command.run({ command: 'spend', args: '' } as any)
    expect(run.text).toContain('5h')
    expect(run.text).toContain('%37 used (resets in 3h')
    expect(run.text).not.toContain('$')
    await ui.unmount()
  })
})
