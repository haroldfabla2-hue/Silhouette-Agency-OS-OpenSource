/** Absence/timeout is not a human rejection. Boolean false is reserved for
 * an actual rejection; unavailable decisions throw with a typed reason. */
export class ConfirmationUnavailableError extends Error {
 readonly code='CONFIRMATION_UNAVAILABLE';
 constructor(readonly reason:'NO_AUTHENTICATED_PRINCIPAL'|'EXPIRED'){
  super(`Confirmation unavailable: ${reason}`);this.name='ConfirmationUnavailableError';
 }
}
