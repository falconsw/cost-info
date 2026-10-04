# Cost Info

A Claude Code mod that shows what your session has cost so far, and the tokens it took, live.

- **Live total.** Updates as the session spends, mid-turn too. It's the same figure `/cost` shows, subagents included.
- **Tokens.** Next to the cost: the session's total, and the running turn's while it works (the last turn's after). Every model request's input, cache writes, cache reads and output, summed, subagents included.
- **Budget.** Green under half, yellow past half, red over, with a one-time warning when you cross it.
- **`/spend`.** Tokens, turns, average per turn, and your priciest turn.
- **Status line.** Also written as `This session: $x · 1.2M tok`.
- **VS Code.** The extension has no room above the prompt, so there the meter opens as a **Cost** pane instead. Run `/spend` to bring it back if you close it.

On a Pro or Max plan the figure is what the same usage would cost on the API, not what you're billed. Tokens count from when the mod loaded into the session, so a resumed session's earlier tokens aren't in the total.

## Install

Requires Claude Code 2.1.288 or later.

```
/plugin marketplace add falconsw/cost-info
/plugin install cost-info@falconsw-mods
/reload-plugins
```

The VS Code extension has no `/plugin` command; run the same from a shell, then start a new session:

```
claude plugin marketplace add falconsw/cost-info
claude plugin install cost-info@falconsw-mods
```

To get a new version: `claude plugin update cost-info@falconsw-mods`.

## Configure

Set **Budget (USD)** for Cost Info in `/config`. The default is $5; set it to 0 to turn the budget off.

## Develop

```
claude plugin validate ./cost-info
claude plugin test ./cost-info
claude --plugin-dir ./cost-info   # reloads as you save
```

A mod runs inside Claude Code with the same access Claude Code has. Read the source before you install it: it's one file, [`cost-info/hooks/register.tsx`](cost-info/hooks/register.tsx).
