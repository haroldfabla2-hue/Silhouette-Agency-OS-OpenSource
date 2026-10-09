# Stagehand perception layer

Tool: `browser_ai_perception` (operations: `status`, `goto`, `observe`, `extract`, `act`).

## Configuration (environment)

| Variable | Required | Meaning |
|---|---|---|
| `STAGEHAND_MODEL` | yes | Model id used by Stagehand, e.g. `provider/model`. No default. |
| `STAGEHAND_MODEL_API_KEY` | yes | API key for that model. |
| `STAGEHAND_BROWSER` | no | `local` (default) or `browserbase`. |
| `BROWSERBASE_API_KEY` | only for `browserbase` | Remote browser key. |
| `STAGEHAND_HEADLESS` | no | `false` to show the local browser. Default `true`. |

## States

- **REAL**: required settings present. Calls go to the real Stagehand runtime and model.
- **UNAVAILABLE**: something is missing. `status` lists the exact variables. `goto`, `observe`, `extract` and `act` fall back to the built-in visual engine and the result says `provider: "builtin"` and `fell_back_from_stagehand: true`. Nothing is simulated.

## Safety

- `act` observes first, then runs the payment/commitment gate on the instruction and the real target BEFORE any interaction. Commitment controls need a human approval grant (EXECUTE_PAYMENT, bound to the destination). Approval failure or error blocks the action.
- Actions are recorded in the browser audit ledger when a session is active.

## Known limit

Stagehand runs its own browser session. It does not share cookies or the current page with the built-in engine. Use `goto` inside the Stagehand session.
