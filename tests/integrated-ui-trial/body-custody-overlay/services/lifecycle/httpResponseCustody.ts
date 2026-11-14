/** Body custody only. No transport creation, fetch replacement or global owner. */
export type HttpBodySource = 'telephony-dial' | 'telephony-dtmf' | 'telephony-hangup';
export type HttpBodyFailure = Readonly<{ source: HttpBodySource; original: unknown }>;
export class HttpBodyCustodyDrainError extends AggregateError {
    constructor(readonly failureCount: number, readonly countOverflow: boolean,
        readonly samples: readonly HttpBodyFailure[]) {
        super(samples.map(sample => sample.original), 'Original HTTP response body cleanup failed');
        this.name = 'HttpBodyCustodyDrainError';
    }
}
/** Per actual service instance. Count occurrences, not unique defects. Never reset
 * on a later successful request. Bounded samples retain original error identity.
 */
export class HttpBodyCustodyFailures {
    private count = 0;
    private overflow = false;
    private readonly samples: HttpBodyFailure[] = [];
    record(source: HttpBodySource, original: unknown): void {
        if (this.count < Number.MAX_SAFE_INTEGER) this.count++;
        else this.overflow = true;
        if (this.samples.length < 8) this.samples.push(Object.freeze({ source, original }));
    }
    drainFailure(): HttpBodyCustodyDrainError | undefined {
        return this.count || this.overflow
            ? new HttpBodyCustodyDrainError(this.count, this.overflow, Object.freeze([...this.samples]))
            : undefined;
    }
}
/** Consumer may read status or use readJson exactly once. Completion means the
 * SAME native body read reached EOF, not bodyUsed, headers, a status or JSON
 * validity. JSON parse happens AFTER that read, so invalid JSON after EOF does
 * not cause a spurious cancel or a body cleanup failure.
 *
 * Cleanup failure is retained independently, never replaces the original
 * consumer error/result. The owning instance's drain MUST inspect this ledger.
 */
export async function withHttpResponseCustody<T>(
    response: Response, failures: HttpBodyCustodyFailures, source: HttpBodySource,
    consume: (readJson: () => Promise<unknown>) => T | Promise<T>,
): Promise<T> {
    let reachedEof = response.body === null;
    let readStarted = false;
    const readJson = async (): Promise<unknown> => {
        if (readStarted) throw new TypeError('Original HTTP response JSON already requested');
        readStarted = true;
        const bytes = await response.arrayBuffer();
        reachedEof = true;
        // WHATWG UTF-8 decode removes the initial BOM, as Response.json does.
        // Do not classify SyntaxError by name: a stream can reject with it too.
        return JSON.parse(new TextDecoder().decode(bytes));
    };
    try { return await consume(readJson); }
    finally {
        if (!reachedEof && response.body !== null) {
            try { await response.body.cancel(); }
            catch (original) { failures.record(source, original); }
        }
    }
}
