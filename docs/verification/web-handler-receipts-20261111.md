# Real WebSocket handler and WAL receipt boundary

Review follow-up to `24a2ab3148ca2e98a9ba9cef9bf941a45b10f958`. Disposable local stores, actual loopback sockets, real application modules and provider transport OFF. No production input, external message, live model response, merge or deployment.

## Executed baseline and corrected path

The baseline used two actual WebSocket connections and the real `agent.send` RPC. The handler ran and logged the missing `web-ui` channel, but the requesting client received zero `session.message` replies. The assertion failed. The baseline log is retained privately.

The corrected ingress creates a one-shot server-side return route bound to the exact originating connection and the selected existing session. It does not broadcast a reply to all clients in a shared personal session. A successful WebSocket send callback returns the same application message ID that the real receiving socket observed. This is local transport acceptance, not remote read acknowledgement. Session selection and existing identity policies are preserved; a nonexistent session is refused before starting the handler. Idempotency keys are scoped to a connection instead of sharing cached request results between unrelated connections.

The actual complete handler now uses one delivery/receipt boundary for normal replies, confirmation acknowledgements, debate replies and pre-send error replies. After any attempted send it does not send a second error reply. After a confirmed send it commits the WAL with the transport ID, and the per-agent memory receipt includes that ID. If memory readback fails, the external reply remains delivered once while the WAL stays pending.

Five real-process tests verify:

- Actual gateway ingress, complete handler, one reply to the origin, no reply event to the other connection, duplicate-request suppression and separate handling of another connection's identical idempotency key. Another real process reads the same committed WAL ID/timestamp and transport receipt.
- The same actual handler with an authored `MEMORY.md` genuinely mode0400. The actual append fails EACCES after the socket receives its one reply. The original file bytes remain intact and WAL remains pending. After the fixture's permissions are explicitly restored, another process records INTERRUPTED with the same WAL ID/timestamp, without re-executing the request. This does not claim restart can bypass a still-unwritable real store.
- The actual confirmation early return for `RECHAZAR TODO` with a disposable SQLite principal and actual signed ingress envelope. It delivers the real no-pending-actions acknowledgement over a real WebSocket and records the receipt. This fixture calls the handler with signed input; it does not upgrade ordinary WebSocket clients' guest identity, grant an effect or simulate a messaging provider.
- A one-use route delivers an authored transport payload once, its receipt matches the actual received frame, and reuse sends nothing. The payload is explicitly not a model response.
- A nonexistent reply session is refused before handler/WAL execution.

The first cross-connection test used a five-second wait, but the actual OFF background fallback retains its ten-second rate limiter. That harness failure is preserved; the corrected bound waits for the real path instead of replacing its response. A missing WAL file before any accepted input is treated as no record, not a fabricated empty file.

## What this does not prove

With providers OFF, `generateAgentResponse` returns its real missing-API-key error. Delivering that result proves the error transport/receipt boundary, not positive cognition, useful task execution or goal-to-delivery completion. The confirmation acknowledgement is a real control-path result, not a generated research result. The debate branch shares the source boundary but was not positively exercised with a model. No positive Telegram/WhatsApp/Discord-provider delivery is claimed. The gateway's existing shared-session and event-broadcast policies were not redesigned or certified here.

Receipt metadata does not prove human reading or task correctness. Process restart is not a hardware power-loss/fsync proof for every store. Production compatibility inspection and state-preserving rollback remain prerequisites to a separately authorized rollout, not actions performed here. Positive Qdrant/scheduler acceptance, applied learning improvements and full cognitive end-to-end acceptance remain open.

## Grouped verification

Full isolated suite: 1483 passed, zero failed, two unchanged skips, 230 files, 111.95 seconds. Lint: zero errors, 419 existing warnings. Frontend build: 19.94 seconds. Server build: 4.21 seconds. The two skips remain the credential-less ElevenLabs test and cold-narrator harness dependency; neither counts as acceptance. This source needs its own exact-SHA TypeScript gate, reported separately after completion.
