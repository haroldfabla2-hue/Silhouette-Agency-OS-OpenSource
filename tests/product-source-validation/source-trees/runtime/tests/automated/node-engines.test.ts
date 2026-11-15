import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

/** Lowest version a ">=x.y.z" range allows. */
function floor(range: string | undefined): [number, number, number] | null {
    const m = /^>=\s*(\d+)\.(\d+)\.(\d+)/.exec(range || '');
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function gte(a: number[], b: number[]): boolean {
    for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
    return true;
}

describe('Node minimum is declared and consistent (regression: no engines, Node 20 in CI/Docker)', () => {
    const pkg = JSON.parse(read('package.json'));
    const stagehand = JSON.parse(read('node_modules/@browserbasehq/stagehand/package.json'));

    it('package.json declares engines.node', () => {
        expect(floor(pkg.engines?.node)).not.toBeNull();
    });

    it('declared minimum is at least what every dependency with a Node >= engine requires', () => {
        const declared = floor(pkg.engines?.node)!;
        const required = floor(stagehand.engines?.node);
        expect(required).not.toBeNull();
        expect(gte(declared, required!)).toBe(true);
    });

    it('CI never tests a Node below the declared minimum', () => {
        const declared = floor(pkg.engines?.node)!;
        const ci = read('.github/workflows/ci.yml');
        const line = /node-version:\s*\[([^\]]+)\]/.exec(ci);
        expect(line).not.toBeNull();
        const versions = line![1].split(',').map(v => v.replace(/['"\s]/g, ''));
        for (const v of versions) {
            const parts = v.split('.').map(Number);
            while (parts.length < 3) parts.push(parts.length === 1 ? 99 : 99); // "22" means any 22.x
            expect(gte(parts, declared), `CI matrix entry ${v}`).toBe(true);
        }
        // The floor itself must be exercised.
        expect(versions.some(v => v === `${declared[0]}.${declared[1]}.${declared[2]}`)).toBe(true);
    });

    it('Docker images use a supported Node major', () => {
        const declared = floor(pkg.engines?.node)!;
        const images = [...read('Dockerfile').matchAll(/^FROM node:(\d+)/gim)].map(m => Number(m[1]));
        expect(images.length).toBeGreaterThan(0);
        for (const major of images) expect(major).toBeGreaterThanOrEqual(declared[0]);
    });
});
