/**
 * PR-E guards:
 *  1. extractExecuteMarkers: balanced-brace [EXECUTE:] parsing (nested args,
 *     braces inside strings, garbage skipped).
 *  2. openAICompatibleAdapter: native tool-call deltas are accumulated and
 *     re-emitted as [EXECUTE:] text (was: leg-killing InferenceError).
 *  3. authMiddleware: the master API token authenticates with an explicit
 *     CREATOR system identity (was: req.user unset -> downstream GUEST).
 */
import { describe, it, expect } from 'vitest';
import { extractExecuteMarkers } from '../../services/tools/execMarker';
import { openAICompatibleAdapter } from '../../services/llm/streamAdapters';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('extractExecuteMarkers', () => {
    it('parses a simple marker', () => {
        const [m] = extractExecuteMarkers('[EXECUTE: write_file {"path":"/work/a.txt"}]');
        expect(m.name).toBe('write_file');
        expect(m.args).toEqual({ path: '/work/a.txt' });
        expect(m.originalMatch).toBe('[EXECUTE: write_file {"path":"/work/a.txt"}]');
    });

    it('survives nested objects and braces inside strings', () => {
        const text = '[EXECUTE: t {"a":{"b":1},"s":"}{"}]';
        const [m] = extractExecuteMarkers(text);
        expect(m.args).toEqual({ a: { b: 1 }, s: '}{' });
    });

    it('skips invalid JSON and unbalanced markers', () => {
        expect(extractExecuteMarkers('[EXECUTE: t {bad}]')).toHaveLength(0);
        expect(extractExecuteMarkers('[EXECUTE: t {"a":1}')).toHaveLength(0);
        expect(extractExecuteMarkers('no markers here')).toHaveLength(0);
    });
});

describe('openAICompatibleAdapter native tool calls', () => {
    const def: any = { id: 'TEST', transport: 'openai-compatible', baseUrl: 'https://x', apiKeyEnv: 'K', model: 'm', discovery: false };
    const prepared: any = { systemPrompt: 's', chatHistory: [], task: 't', model: undefined, temperature: 0.5, maxTokens: 10, signal: undefined };

    function stubClient(events: any[]) {
        return {
            configured: () => true,
            model: () => 'm',
            discover: async () => ({}),
            stream: async function* () { for (const e of events) yield e; },
        } as any;
    }

    it('accumulates fragmented native deltas and emits one [EXECUTE:] marker', async () => {
        const adapter = openAICompatibleAdapter(def, stubClient([
            { type: 'text', text: 'Creando el archivo. ' },
            { type: 'tool', index: 0, delta: { index: 0, function: { name: 'write_file' } } },
            { type: 'tool', index: 0, delta: { index: 0, function: { arguments: '{"path":"/work/a.txt",' } } },
            { type: 'tool', index: 0, delta: { index: 0, function: { arguments: '"content":"ok"}' } } },
        ]));
        let out = '';
        for await (const t of adapter.stream(prepared)) out += t;
        expect(out).toContain('Creando el archivo. ');
        expect(out).toContain('[EXECUTE: write_file {"path":"/work/a.txt","content":"ok"}]');
    });

    it('skips spurious empty deltas without emitting anything', async () => {
        const adapter = openAICompatibleAdapter(def, stubClient([
            { type: 'text', text: 'hola' },
            { type: 'tool', index: 0, delta: { index: 0, function: {} } },
        ]));
        let out = '';
        for await (const t of adapter.stream(prepared)) out += t;
        expect(out).toBe('hola');
    });

    it('discards calls whose args never become valid JSON', async () => {
        const adapter = openAICompatibleAdapter(def, stubClient([
            { type: 'tool', index: 0, delta: { index: 0, function: { name: 'write_file', arguments: '{broken' } } },
        ]));
        let out = '';
        for await (const t of adapter.stream(prepared)) out += t;
        expect(out).not.toContain('[EXECUTE:');
    });
});

describe('authMiddleware master token identity', () => {
    it('assigns an explicit CREATOR system identity', () => {
        const src = readFileSync(join(__dirname, '..', '..', 'server', 'middleware', 'authMiddleware.ts'), 'utf8');
        expect(src).toContain("(req as any).user = { id: 'system:api-token', role: 'CREATOR' };");
    });
});
