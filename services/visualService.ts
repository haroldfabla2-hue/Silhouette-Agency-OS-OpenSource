/**
 * Visual Service — local visual cortex powered by PhotoCraft (Apache-2.0/MIT).
 *
 * Wraps the official photocraft-cli binary in one-shot mode: no daemon, no sessions,
 * no cloud, no paid APIs. Every operation is a spawned CLI call with validated args.
 * If the binary is missing the service reports UNAVAILABLE honestly — never fakes output.
 *
 * Boundaries:
 *  - Image generation from a prompt is NOT here (that is the paid diffusion tier).
 *  - This is composition/edition: documents, layers, text, gradients, filters, PSD I/O,
 *    format conversion, batch processing — 900+ engine commands, agent-drivable.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const BIN = process.env.PHOTOCRAFT_BIN || '/opt/silhouette/tools/photocraft/bin/photocraft-cli';
const READ_ROOT = path.resolve(process.env.PHOTOCRAFT_READ_ROOT || '/opt/silhouette/workspace');
const WRITE_ROOT = path.resolve(process.env.PHOTOCRAFT_WRITE_ROOT || '/opt/silhouette/output');
const REGISTRY_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 120_000;

const OUTPUT_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'psd', 'pcraft', 'bmp', 'tga', 'exr']);

export interface VisualResult {
    ok: boolean;
    unavailable?: boolean;
    error?: string;
    data?: any;
}

export interface ComposeText {
    x: number; y: number; text: string;
    size?: number; color?: string; font?: string; align?: 'left' | 'center' | 'right';
    /** CSS weight scale 100..900 (variable fonts interpolate; static families pick nearest face). */
    weight?: number;
    italic?: boolean;
    /** 1/1000 em (Photoshop tracking). */
    tracking?: number;
    /** Line height in pt (paragraph text). */
    leading?: number;
}
export interface ComposeImage { path: string; scale?: number; fit?: boolean; }
export interface ComposeSpec {
    width: number; height: number; resolution?: number;
    background?: { type: 'gradient'; from: string; to: string; angle?: number } | { type: 'color'; color: string };
    texts?: ComposeText[];
    images?: ComposeImage[];
    adjustments?: Array<{ command: string; params?: Record<string, any> }>;
    out: string;
}

interface RegistryEntry { id: string; label?: string; params?: string; needsDocument?: boolean; }

let registryCache: { at: number; entries: Map<string, RegistryEntry> } | null = null;

function run(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        child.stdout!.on('data', (d) => { stdout += d; });
        child.stderr!.on('data', (d) => { stderr += d; });
        const killer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`photocraft timeout after ${timeoutMs}ms`)); }, timeoutMs);
        child.on('error', (e) => { clearTimeout(killer); reject(e); });
        child.on('close', (code) => { clearTimeout(killer); resolve({ code, stdout, stderr }); });
    });
}

function assertPlainObject(v: any, name: string): asserts v is Record<string, any> {
    if (v === undefined || v === null) return;
    if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${name} must be a JSON object`);
}

/** Resolve p and require it to live under root. Throws otherwise. */
export function confinePath(p: string, root: string): string {
    if (typeof p !== 'string' || !p.trim()) throw new Error('path must be a non-empty string');
    const resolved = path.resolve(p);
    const rootResolved = path.resolve(root);
    if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
        throw new Error(`path escapes allowed root: ${p}`);
    }
    return resolved;
}

export function isAvailable(): boolean {
    try { return fs.existsSync(BIN) && fs.statSync(BIN).isFile(); } catch { return false; }
}

function unavailableResult(): VisualResult {
    return {
        ok: false,
        unavailable: true,
        error: `PhotoCraft binary not found at ${BIN}. Run scripts/install-photocraft.sh on the host. Visual cortex composition is UNAVAILABLE, not degraded.`
    };
}

async function getRegistry(): Promise<Map<string, RegistryEntry>> {
    if (registryCache && Date.now() - registryCache.at < REGISTRY_TTL_MS) return registryCache.entries;
    const { code, stdout, stderr } = await run(['commands', '--json']);
    if (code !== 0) throw new Error(`photocraft commands failed: ${stderr.slice(0, 300)}`);
    const list = JSON.parse(stdout) as RegistryEntry[];
    const entries = new Map(list.map((c) => [c.id, c]));
    registryCache = { at: Date.now(), entries };
    return entries;
}

export async function listCommands(filter?: string): Promise<VisualResult> {
    if (!isAvailable()) return unavailableResult();
    try {
        const registry = await getRegistry();
        let all = [...registry.values()];
        if (filter) {
            const f = filter.toLowerCase();
            all = all.filter((c) => c.id.toLowerCase().includes(f) || (c.label || '').toLowerCase().includes(f));
        }
        return { ok: true, data: { count: all.length, commands: all.slice(0, 500) } };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
}

/** List the font families the engine can use right now (fontconfig dirs + bundled). */
export async function listFonts(): Promise<VisualResult> {
    if (!isAvailable()) return unavailableResult();
    const probe = path.join(WRITE_ROOT, `fonts-probe-${Date.now()}.png`);
    try {
        const res = await execute({ newDoc: { width: 8, height: 8 }, steps: [{ command: 'type.fonts' }], out: probe });
        if (!res.ok) return res;
        const line = (res.data?.log ?? []).find((l: string) => l.includes('"type.fonts"'));
        if (!line) return { ok: false, error: 'type.fonts result missing from engine log' };
        const families: string[] = JSON.parse(line)?.result?.families ?? [];
        return { ok: true, data: { families } };
    } catch (e: any) {
        return { ok: false, error: e.message };
    } finally {
        fs.unlink(probe, () => {});
    }
}

/** Validate an engine command id against the live registry. Returns the entry or throws. */
export async function validateCommand(command: string): Promise<RegistryEntry> {
    if (typeof command !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(command)) {
        throw new Error(`invalid command id: ${command}`);
    }
    const registry = await getRegistry();
    const entry = registry.get(command);
    if (!entry) throw new Error(`unknown engine command: ${command}`);
    return entry;
}

function assertOutputPath(out: string): string {
    const resolved = confinePath(out, WRITE_ROOT);
    const ext = resolved.split('.').pop()?.toLowerCase() || '';
    if (!OUTPUT_EXTENSIONS.has(ext)) throw new Error(`unsupported output extension: .${ext}`);
    return resolved;
}

/**
 * Execute arbitrary engine commands against a document (existing file or a new one),
 * then optionally save. This is the "hacer lo que requiera" path: any of the 900+
 * registry commands, validated live.
 */
export async function execute(opts: {
    command?: string;
    params?: Record<string, any>;
    steps?: Array<{ command: string; params?: Record<string, any> }>;
    doc?: string;
    newDoc?: { width: number; height: number; resolution?: number; mode?: string };
    out?: string;
}): Promise<VisualResult> {
    if (!isAvailable()) return unavailableResult();
    try {
        const steps = opts.steps?.length ? opts.steps : (opts.command ? [{ command: opts.command, params: opts.params }] : []);
        if (!steps.length) throw new Error('nothing to execute: pass command or steps');
        if (steps.length > 50) throw new Error('too many steps (max 50)');

        const args: string[] = ['run'];
        if (opts.doc) {
            args.push(confinePath(opts.doc, READ_ROOT));
        } else if (opts.newDoc) {
            const { width, height } = opts.newDoc;
            if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 30000 || height > 30000) {
                throw new Error('newDoc width/height must be integers in 1..30000');
            }
            args.push('--new', JSON.stringify({ width, height, resolution: opts.newDoc.resolution ?? 72, mode: opts.newDoc.mode ?? 'rgb' }));
        } else {
            throw new Error('execute needs doc (existing file) or newDoc');
        }

        for (const step of steps) {
            await validateCommand(step.command);
            assertPlainObject(step.params, `params for ${step.command}`);
            args.push('--cmd', step.command);
            if (step.params) args.push('--params', JSON.stringify(step.params));
        }

        if (opts.out) args.push('--out', assertOutputPath(opts.out));

        const { code, stdout, stderr } = await run(args);
        if (code !== 0) return { ok: false, error: `photocraft exited ${code}: ${(stderr || stdout).slice(0, 500)}` };
        return { ok: true, data: { output: opts.out ? assertOutputPath(opts.out) : undefined, log: stdout.trim().split('\n').slice(-20) } };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** High-level composition: background + text layers + placed images + adjustments → export. */
export async function compose(spec: ComposeSpec): Promise<VisualResult> {
    if (!isAvailable()) return unavailableResult();
    try {
        if (!spec || typeof spec !== 'object') throw new Error('spec must be an object');
        const { width, height } = spec;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 30000 || height > 30000) {
            throw new Error('width/height must be integers in 1..30000');
        }
        if (!spec.out) throw new Error('spec.out is required');
        const out = assertOutputPath(spec.out);
        if ((spec.texts?.length ?? 0) > 20) throw new Error('too many text layers (max 20)');
        if ((spec.images?.length ?? 0) > 10) throw new Error('too many images (max 10)');

        const steps: Array<{ command: string; params?: Record<string, any> }> = [];
        if (spec.background?.type === 'gradient') {
            const { from, to, angle } = spec.background;
            if (!HEX.test(from) || !HEX.test(to)) throw new Error('background colors must be #rrggbb');
            steps.push({ command: 'layer.newFillLayer.gradient', params: { from, to, angle: angle ?? 90 } });
        } else if (spec.background?.type === 'color') {
            if (!HEX.test(spec.background.color)) throw new Error('background color must be #rrggbb');
            steps.push({ command: 'layer.newFillLayer.solidColor', params: { color: spec.background.color } });
        }
        for (const img of spec.images ?? []) {
            steps.push({ command: 'file.placeEmbedded', params: { path: confinePath(img.path, READ_ROOT), scale: img.scale, fit: img.fit } });
        }
        for (const t of spec.texts ?? []) {
            if (!t.text || typeof t.text !== 'string' || t.text.length > 500) throw new Error('text layer needs text (max 500 chars)');
            if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) throw new Error('text layer needs numeric x/y');
            if (t.color && !HEX.test(t.color)) throw new Error(`text color must be #rrggbb: ${t.color}`);
            if (t.weight !== undefined && (!Number.isFinite(t.weight) || t.weight < 100 || t.weight > 900)) throw new Error('text weight must be 100..900 (CSS scale)');
            if (t.tracking !== undefined && (!Number.isFinite(t.tracking) || t.tracking < -1000 || t.tracking > 10000)) throw new Error('text tracking must be -1000..10000 (1/1000 em)');
            if (t.leading !== undefined && (!Number.isFinite(t.leading) || t.leading < 0 || t.leading > 1296)) throw new Error('text leading must be 0..1296 pt');
            const params: Record<string, any> = { x: t.x, y: t.y, text: t.text, size: t.size ?? 24, color: t.color ?? '#ffffff', font: t.font, align: t.align };
            if (t.weight !== undefined) params.weight = t.weight;
            if (t.italic !== undefined) params.italic = t.italic;
            if (t.tracking !== undefined) params.tracking = t.tracking;
            if (t.leading !== undefined) params.leading = t.leading;
            steps.push({ command: 'type.create', params });
        }
        for (const adj of spec.adjustments ?? []) {
            await validateCommand(adj.command);
            assertPlainObject(adj.params, `params for ${adj.command}`);
            steps.push(adj);
        }

        return await execute({ newDoc: { width, height, resolution: spec.resolution }, steps, out });
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
}

/** Convert between formats (psd, png, jpg, webp, tif, exr…). */
export async function convert(input: string, out: string, quality?: number): Promise<VisualResult> {
    if (!isAvailable()) return unavailableResult();
    try {
        const src = confinePath(input, READ_ROOT);
        const dst = assertOutputPath(out);
        const args = ['convert', src, dst];
        if (quality !== undefined) {
            if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error('quality must be 1..100');
            args.push('--quality', String(quality));
        }
        const { code, stdout, stderr } = await run(args);
        if (code !== 0) return { ok: false, error: `photocraft exited ${code}: ${(stderr || stdout).slice(0, 500)}` };
        return { ok: true, data: { output: dst } };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
}

/** Inspect a document: size, mode, depth, layer tree. */
export async function info(file: string): Promise<VisualResult> {
    if (!isAvailable()) return unavailableResult();
    try {
        const src = confinePath(file, READ_ROOT);
        const { code, stdout, stderr } = await run(['info', src]);
        if (code !== 0) return { ok: false, error: `photocraft exited ${code}: ${(stderr || stdout).slice(0, 500)}` };
        return { ok: true, data: JSON.parse(stdout) };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
}

export const visualService = { isAvailable, listCommands, execute, compose, convert, info };
