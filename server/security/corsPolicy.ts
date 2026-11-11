/** CORS controls cross-origin access, never same-origin app module requests.
 * Keep authentication separate. Origin equality includes scheme and port;
 * neither host suffixes nor other loopback ports gain access implicitly.
 */
export function isAllowedRequestOrigin(origin: string | undefined, protocol: string,
    host: string | undefined, allowedOrigins: readonly string[]): boolean {
    if (!origin) return true;
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return true;
    return !!host && (protocol === 'http' || protocol === 'https')
        && origin === `${protocol}://${host}`;
}
