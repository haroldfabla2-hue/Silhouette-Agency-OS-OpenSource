// Imported by auth transports; importing alone has no effects. Normal native
// CLI env/config precedence is unchanged until dedicated desktop adapter binds.
import { timingSafeEqual } from 'node:crypto';
let desktopToken: string | undefined;
export function bindPrivateDesktopToken(token: string): void {
    if (desktopToken !== undefined || !/^[a-f0-9]{64}$/.test(token)) throw new Error('DESKTOP_TOKEN_INVALID');
    desktopToken = token;
}
export function privateDesktopToken(): string | undefined { return desktopToken; }
export function privateDesktopBearer(header: unknown): boolean {
    if (!desktopToken || typeof header !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(header)) return false;
    return timingSafeEqual(Buffer.from(header.slice(7), 'hex'), Buffer.from(desktopToken, 'hex'));
}

// Exact recovery exception, bound only by the trusted terminal owner. It is
// not an HTTP/public/auth bypass and never admits a new session or input root.
let recoveryUpgrade: ((request: unknown) => boolean) | undefined;
export function bindPrivateDesktopRecoveryUpgrade(check: (request: unknown) => boolean): void {
    if (recoveryUpgrade) throw new Error('DESKTOP_RECOVERY_ALREADY_BOUND');
    recoveryUpgrade = check;
}
export function privateDesktopRecoveryUpgrade(request: any): boolean {
    if (!privateDesktopBearer(request?.headers?.authorization)) return false;
    try { return recoveryUpgrade?.(request) === true; } catch { return false; }
}
