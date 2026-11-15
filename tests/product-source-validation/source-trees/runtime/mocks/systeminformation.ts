// Browser shim for the `systeminformation` package.
// The real hardware data lives on the SERVER (see GET /v1/system/resources).
// This shim exists only so the browser bundle builds; it NEVER fabricates
// CPU/memory numbers. Any call fails loudly with an honest UNAVAILABLE.

const unavailable = (what: string): Error => new Error(
    `UNAVAILABLE: ${what} cannot be read in the browser. ` +
    `Use the server endpoint GET /v1/system/resources for real hardware metrics.`
);

export const cpu = async (): Promise<never> => { throw unavailable('CPU info'); };
export const currentLoad = async (): Promise<never> => { throw unavailable('CPU load'); };
export const mem = async (): Promise<never> => { throw unavailable('Memory info'); };

export default { cpu, currentLoad, mem };
