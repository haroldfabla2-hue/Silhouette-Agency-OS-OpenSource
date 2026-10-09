# Payments and collections (multi-provider)

Entry point: `services/payments/paymentGateway.ts`. Tools: `payments_providers`, `payments_initiate`, `payments_confirm`, `payments_status`, `payments_payout`.

## Providers

| Id | State today | What it needs |
|---|---|---|
| `paypal` | REAL when configured | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE=sandbox` or `live` (no default, so nothing runs against live by accident) |
| `stripe_issuing` | UNAVAILABLE | Adapter slot only. Not implemented; reports UNAVAILABLE even if `STRIPE_ISSUING_API_KEY` is set. The existing FinancialVault remains the card path. |

Select with the `provider` argument or `PAYMENT_PROVIDER`. Optional cap: `PAYMENTS_MAX_AMOUNT_CENTS`.
New rails: implement `PaymentProvider` (`services/payments/types.ts`) and `paymentGateway.register(...)`.

## Operations

- `initiate` (cobro): creates a PayPal order and returns the link the payer must approve. No money moves.
- `confirm`: captures an order the payer already approved. Re-reads the order first and refuses if amount/currency differ from what was approved, or if the payer has not approved.
- `payout`: sends money to an email recipient (PayPal Payouts).
- `status`: read-only.

## Safety

- `initiate`, `confirm` and `payout` each need a human approval grant (EXECUTE_PAYMENT) bound to provider, direction, destination, amount and currency. Single use. Approval failure or error blocks the call before any HTTP request.
- An UNAVAILABLE provider never triggers an approval prompt and never makes a request.
- Results are REAL (provider answered), FAILED (provider refused or errored, with its message) or UNAVAILABLE (nothing attempted). Nothing is simulated.

## Not verified here

The PayPal calls are tested against a scripted HTTP layer. No real PayPal request has been made; that needs sandbox credentials from the account owner.
