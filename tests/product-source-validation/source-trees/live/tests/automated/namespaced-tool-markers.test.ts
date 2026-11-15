/**
 * PR-F guards: namespaced native tool names (gpt-oss emits "tool.write_file")
 * must be detected, parsed and normalized — the first live test after PR-E
 * produced [EXECUTE: tool.write_file {...}] which \w+ never matched.
 */
import { describe, it, expect } from 'vitest';
import { extractExecuteMarkers, normalizeToolName } from '../../services/tools/execMarker';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('namespaced tool names', () => {
    it('extracts namespaced markers and normalizes the prefix', () => {
        const [m] = extractExecuteMarkers('[EXECUTE: tool.write_file {"path":"/work/a.txt"}]');
        expect(m.name).toBe('tool.write_file');
        expect(normalizeToolName(m.name)).toBe('write_file');
    });

    it('normalizeToolName strips only known prefixes', () => {
        expect(normalizeToolName('write_file')).toBe('write_file');
        expect(normalizeToolName('tools.web_search')).toBe('web_search');
        expect(normalizeToolName('functions.read_file')).toBe('read_file');
        expect(normalizeToolName('my_custom_tool')).toBe('my_custom_tool');
    });

    it('detection patterns in chatToolIntegration allow dotted names', () => {
        const src = readFileSync(join(__dirname, '..', '..', 'services', 'chatToolIntegration.ts'), 'utf8');
        expect(src).toContain('/\\[EXECUTE:\\s*([\\w.]+)\\s*(\\{.*?\\})\\]/gi');
        expect(src).toContain('/\\[TOOL:\\s*([\\w.]+)\\((.*?)\\)\\]/gi');
        expect(src).toContain('const toolName = normalizeToolName(rawToolName);');
    });
});
