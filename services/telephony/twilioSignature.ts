import crypto from 'crypto';

/**
 * Twilio webhook signature (X-Twilio-Signature):
 * base64(HMAC-SHA1(authToken, fullUrl + sorted(key + value for each POST param))).
 */
export function computeTwilioSignature(authToken: string, fullUrl: string, params: Record<string, string>): string {
    const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], fullUrl);
    return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

/** Constant-time comparison. Missing or malformed signatures are rejected. */
export function verifyTwilioSignature(authToken: string, fullUrl: string, params: Record<string, string>, signature: string | undefined): boolean {
    if (!authToken || !signature) return false;
    const expected = Buffer.from(computeTwilioSignature(authToken, fullUrl, params));
    const given = Buffer.from(signature);
    if (expected.length !== given.length) return false;
    return crypto.timingSafeEqual(expected, given);
}

export function escapeXml(s: string): string {
    return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
}
