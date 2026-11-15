import { describe, it, expect } from 'vitest';
import { createSseParser } from '../../utils/sseClient';

describe('createSseParser', () => {
    it('emits a complete single-line data frame', () => {
        const out: string[] = [];
        const push = createSseParser(d => out.push(d));
        push('data: {"a":1}\n\n');
        expect(out).toEqual(['{"a":1}']);
    });

    it('assembles frames split across chunks', () => {
        const out: string[] = [];
        const push = createSseParser(d => out.push(d));
        push('data: hel');
        expect(out).toEqual([]);
        push('lo wo');
        expect(out).toEqual([]);
        push('rld\n\n');
        expect(out).toEqual(['hello world']);
    });

    it('joins multi-line data with newline', () => {
        const out: string[] = [];
        const push = createSseParser(d => out.push(d));
        push('data: line1\ndata: line2\n\n');
        expect(out).toEqual(['line1\nline2']);
    });

    it('ignores heartbeat comments and non-data frames', () => {
        const out: string[] = [];
        const push = createSseParser(d => out.push(d));
        push(': heartbeat\n\nevent: ping\n\ndata: real\n\n');
        expect(out).toEqual(['real']);
    });

    it('handles CRLF frame separators', () => {
        const out: string[] = [];
        const push = createSseParser(d => out.push(d));
        push('data: one\r\n\r\ndata: two\r\n\r\n');
        expect(out).toEqual(['one', 'two']);
    });

    it('emits multiple frames from one chunk in order', () => {
        const out: string[] = [];
        const push = createSseParser(d => out.push(d));
        push('data: a\n\ndata: b\n\ndata: c\n\n');
        expect(out).toEqual(['a', 'b', 'c']);
    });
});
