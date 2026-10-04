import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const usage = (usd: number) => ({
  value: { startedAt: 0, rateLimits: [], context: { tokens: 1, window: 200000, percent: 0 }, cost: { usd } },
})

// Hooks registered here run after the mod and stand for what Claude Code would answer.
const engine = (on: On) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
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

const BAND = {
  plugin: 'cost-info',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
} as const

describe('cost-info', () => {
  test('shows the cost at start and updates it after each measure', async ($, on) => {
    let status: string | undefined
    let usd = 0.0042

    engine(on)
    on('ui.status', ($, e) => {
      status = e.text

      return { value: undefined }
    })
    on('session.usage', () => usage(usd))

    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    expect(status).toBe('This session: $0.0042')

    usd = 1.237
    await $.session.measure(measure(usd))
    expect(status).toBe('This session: $1.24')
  })

  test('ignores measurements where the cost did not move', async ($, on) => {
    let calls = 0

    engine(on)
    on('ui.status', () => {
      calls += 1

      return { value: undefined }
    })

    await $.session.measure({
      context: { window: 200000, tokens: 1000, percent: 1 },
      rateLimits: [],
      cost: { usd: 1 },
      changed: ['context'],
    })
    expect(calls).toBe(0)
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`the band shows the cost and the last turn (${surface})`, async ($, on) => {
      let usd = 0.12

      engine(on)
      on('ui.status', () => ({ value: undefined }))
      on('session.usage', () => usage(usd))

      await $.session.start({ cwd: '/work', surface, isInteractive: true } as any)
      const ui = await $.ui.mount({ ...BAND, surface } as any)

      await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
      expect(await ui.find({ type: 'Text', text: /\$0\.12/ })).toBeDefined()

      usd = 0.42
      await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
      expect(await ui.find({ type: 'Text', text: /\$0\.42/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /last turn \$0\.30 · 2 turns/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /\$5\.00 budget/ })).toBeDefined()
      await ui.unmount()
    })
  }

  test('warns once when the session passes the budget', { options: { budget: 1 } }, async ($, on) => {
    const toasts: string[] = []

    engine(on)
    on('ui.status', () => ({ value: undefined }))
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

  test('on VS Code, which has no band, the meter opens in a pane', async ($, on) => {
    const opened: string[] = []

    engine(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.usage', () => usage(0.42))
    on('session.surfaces', () => ({ value: ['vscode'] }))
    on('ui.open', ($, e) => {
      opened.push(e.id)

      return { value: { isPlaced: true } }
    })

    await $.session.start({ surface: null, isInteractive: true, cwd: '/work' } as any)
    await $.session.attach({ surface: 'vscode', clientId: 'vscode:default' })
    expect(opened).toEqual(['cost-info'])

    const pane = await $.ui.mount({
      plugin: 'cost-info',
      surface: 'vscode',
      component: 'Pane',
      requestId: 'cost-info',
      props: { title: 'Cost', isFocused: false, bodyColumns: 80, placement: 'dock' },
    } as any)
    expect(await pane.find({ type: 'Text', text: /Nothing spent yet/ })).toBeDefined()

    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(await pane.find({ type: 'Text', text: /\$0\.42/ })).toBeDefined()

    const run = await $.command.run({ command: 'spend', args: '' } as any)
    expect(run.text).toContain('This session: $0.42')
    expect(run.text).toContain('Turns         1')
    expect(opened).toEqual(['cost-info', 'cost-info'])
    await pane.unmount()
  })
})
