/**
 * [Honest labels] The dashboard must name metrics for what they measure.
 * "Neural Load" was the host CPU (si.currentLoad) with a sci-fi name;
 * "Consciousness Phi" is a weighted composite of real signals, not IIT.
 * Alberto's standing rule: nothing fake — labels included.
 * Source-text assertions (repo has no React/jsdom test infra): these guard
 * the honest labels against regression.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const dashboard = readFileSync(resolve(__dirname, '../../components/Dashboard.tsx'), 'utf8');
const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');

describe('honest metric labels', () => {
    it('CPU card is labeled Host CPU, never "Neural Load"', () => {
        expect(dashboard).toContain('label="Host CPU"');
        expect(dashboard).not.toContain('Neural Load');
    });

    it('composite index is labeled Cognitive Health, never "Consciousness Phi"', () => {
        expect(dashboard).toContain('label="Cognitive Health"');
        expect(dashboard).not.toContain('"Consciousness Phi"');
        expect(dashboard).not.toContain("'Consciousness Phi'");
    });

    it('Cognitive Health card discloses its composite nature', () => {
        expect(dashboard).toContain('composite: memory + throughput + introspection + graph');
    });

    it('honest N/A fallback when the engine has not published is preserved', () => {
        expect(dashboard).toContain('engine has not published yet');
        expect(dashboard).toContain("phi === null ? 'N/A'");
    });

    it('CPU thresholds still map to real host CPU semantics', () => {
        expect(dashboard).toContain("metrics.realCpu || 0");
        expect(dashboard).toContain("'Critical'");
    });

    it('App.tsx no longer refers to the old theatrical name', () => {
        expect(app).not.toContain('Consciousness Phi');
    });
});
