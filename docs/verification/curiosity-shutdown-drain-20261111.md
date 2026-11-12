# Curiosity shutdown and delivery receipt follow-up

Stacked on `2e6017b7023a4e31310b14eed55dbc06c6b3da65`. Branch-only review candidate. No merge, deployment, production store, external provider request or real user message was part of this work.

## Reproduced loss through the actual application

An authored 250-event burst passed through the actual memory bus and curiosity subscriptions immediately before shutdown. The first diagnostic called the real SIGTERM handler via `process.emit`: the old shutdown exited zero with only 33/250 mentions in the curiosity snapshot. This is handler execution, not an OS-generated signal.

The automated regression then started a complete disposable app with a real loopback HTTP listener, emitted the authored events, and used `process.kill(process.pid, 'SIGTERM')`. Running that test against the previous source failed: the expected topic count was absent from the saved snapshot. The corrected source passes with exactly 250 mentions and a zero exit. No generated provider text or substituted service response is used.

The shutdown fence now stops both scheduled exploration timers, detaches topic subscriptions, refuses new public mutations, and waits for operations and event writes accepted before the fence. Shutdown is idempotent. The application awaits this drain before closing storage and exiting. Its ten-second timeout starts before the first awaited drain, not after it. A rejected curiosity drain or WAL shutdown marks the exit unclean instead of silently exiting zero.

Four subprocess tests cover service-level accepted operations/events, post-fence refusal/idempotence, actual app OS SIGTERM, and actual corrupt-snapshot shutdown. The corrupt app exits one and retains the original exact bytes. Positive active-provider research and timeout during a live provider operation are not acceptance claims.

Early test-harness failures are retained in private evidence: the first automated app harness incorrectly assumed OFF first boot migrated the PORT environment variable. OFF deliberately bypasses that migration. The corrected test writes a disposable authored listener config. No application config behavior was changed to satisfy the test.

## Telegram source receipt correction

The Telegram channel previously returned invented `sent` and `media-sent` strings on paths without a confirmed provider message ID. It could also return a later text ID despite a failed earlier chunk or failed media. It now returns a provider ID only when every requested supported part has a real ID. Unsupported or unverified parts return null without resending completed parts. A caught delivery error no longer sends an extra error message, since the original request may already have reached the provider.

This correction is source-reviewed and included in the global checks. It is NOT a real Telegram-provider delivery test. The web gateway's pre-existing unregistered-channel route remains open, as do alternate early-return delivery paths and whole-handler post-send/WAL acceptance. A provider message ID confirms service acceptance, not human receipt or reading.

## Grouped verification

- Full isolated suite: 1478 passed, zero failed, two unchanged skips, 229 files, 106.44 seconds.
- Lint: zero errors, 419 existing warnings.
- Frontend build: 20.65 seconds. Server build: 4.42 seconds.
- The skips remain ElevenLabs without a credential and the cold-narrator harness dependency. They are not acceptance.
- The prior global TypeScript gate for `2e6017b` does not cover this tree. Its own single exact-source gate is reported separately after it finishes.

This evidence does not certify full shutdown of every subsystem, every in-flight external action, production rollout/rollback, meaningful cognition/research, applied learning improvements, complete task resume, or goal-to-delivery product completion.
