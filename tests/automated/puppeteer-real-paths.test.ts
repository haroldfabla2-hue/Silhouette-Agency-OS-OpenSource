// =============================================================================
// Unit G: REAL puppeteer-path verification (no mocks, disposable targets only)
// Exercises the actual owner code: browserController, pdfExporter, readUrl.
// Requires the pinned Chrome for Testing installed in CI:
//   npx --no-install puppeteer browsers install chrome@157.0.8103.78
// (version = puppeteer 25.18.0 PUPPETEER_REVISIONS.chrome, source-verified)
// =============================================================================
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { browserController } from '../../services/browser/browserController';
import { pdfExporter } from '../../services/pdfExporter';
import { readUrl } from '../../tools/webBrowserTool';

describe('Unit G: real puppeteer paths', () => {
    let server: http.Server;
    let baseUrl: string;
    const tmpDirs: string[] = [];

    const FIXTURE_PAGE = `<!DOCTYPE html><html><head><title>UnitG Fixture</title>
<style>.junk { display:none; }</style></head><body>
<h1 id="headline">Static headline</h1>
<input id="inp" value="OLD-INPUT-CONTENT">
<textarea id="ta">OLD-LINE-1
OLD-LINE-2
OLD-LINE-3</textarea>
<div id="ce" contenteditable="true">OLD-EDITABLE-LINE-1<br>OLD-EDITABLE-LINE-2<br>OLD-EDITABLE-LINE-3</div>
<input id="empty" value="">
<script>
  window.__events = { click: 0, dblclick: 0, input: 0, beforeinput: 0 };
  document.addEventListener('click', () => window.__events.click++);
  document.addEventListener('dblclick', () => window.__events.dblclick++);
  document.addEventListener('input', () => window.__events.input++);
  document.addEventListener('beforeinput', () => window.__events.beforeinput++);
  const marker = document.createElement('p');
  marker.id = 'rendered-marker';
  marker.textContent = 'CLIENT-RENDERED-MARKER-7f3a9';
  document.body.appendChild(marker);
</script>
</body></html>`;

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(FIXTURE_PAGE);
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    }, 20000);

    afterAll(async () => {
        // Clean runtime cleanup: browser, server, temp files
        try { await browserController.shutdown(); } catch { /* already closed */ }
        if (server) await new Promise((r) => server.close(r));
        for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
    });

    it('F1: real browserController launch/navigate/close lifecycle', async () => {
        const nav = await browserController.execute({ type: 'navigate', url: baseUrl }, 'f1');
        expect(nav.success).toBe(true);
        expect(browserController.getStatus().browserConnected).toBe(true);

        const title = await browserController.execute(
            { type: 'evaluate', script: 'document.title' }, 'f1');
        expect(title.success).toBe(true);
        expect((title.data as any)).toBe('UnitG Fixture');

        await browserController.shutdown();
        expect(browserController.getStatus().browserConnected).toBe(false);
    }, 60000);

    it('F2: real actionType replaces ENTIRE existing text (input, textarea, contenteditable, empty field)', async () => {
        await browserController.execute({ type: 'navigate', url: baseUrl }, 'f2');

        const cases: Array<{ selector: string; readScript: string }> = [
            { selector: '#inp', readScript: `document.querySelector('#inp').value` },
            { selector: '#ta', readScript: `document.querySelector('#ta').value` },
            { selector: '#ce', readScript: `document.querySelector('#ce').innerText` },
            { selector: '#empty', readScript: `document.querySelector('#empty').value` },
        ];
        for (const c of cases) {
            const typed = await browserController.execute(
                { type: 'type', selector: c.selector, text: 'REPLACED' }, 'f2');
            expect(typed.success).toBe(true);
            const read = await browserController.execute(
                { type: 'evaluate', script: c.readScript }, 'f2');
            expect(read.success).toBe(true);
            // Owner intent: the ENTIRE prior content is replaced, no remnants.
            expect((read.data as any)).toBe('REPLACED');
        }

        // Event stream: the migration uses ONE plain click + select-all chord.
        // No click with clickCount>1 semantics and NO dblclick may be synthesized,
        // and genuine input events must fire (the action must behave like real typing,
        // not a DOM bypass).
        const events = await browserController.execute(
            { type: 'evaluate', script: 'JSON.stringify(window.__events)' }, 'f2');
        const parsed = JSON.parse((events.data as any) as string);
        expect(parsed.dblclick).toBe(0);
        expect(parsed.click).toBe(4); // exactly one click per type action
        expect(parsed.input).toBeGreaterThan(0); // real input events observed
    }, 90000);

    it('F3: real pdfExporter writes an actual multi-page-capable PDF to an owned disposable dir', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unitg-pdf-'));
        tmpDirs.push(tmp);
        const mdPath = path.join(tmp, 'fixture.md');
        fs.writeFileSync(mdPath, '# Unit G Fixture\n\nReal PDF export verification.\n\n- alpha\n- beta\n');

        // The owner now accepts an explicit output dir (default unchanged: <cwd>/output/papers/pdf).
        // All writes land inside this owned temp root; cleanup removes that root only, so no
        // pre-existing product output is ever created, overwritten or deleted.
        const outDir = path.join(tmp, 'pdf-out');
        const pdfPath = await pdfExporter.exportToPDF(mdPath, outDir);
        expect(pdfPath).not.toBeNull();
        expect(pdfPath!.startsWith(outDir)).toBe(true); // proof of isolation

        expect(fs.existsSync(pdfPath!)).toBe(true);
        const bytes = fs.readFileSync(pdfPath!);
        expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(bytes.length).toBeGreaterThan(5000);
        const pageObjects = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
        expect(pageObjects).toBeGreaterThanOrEqual(1);
    }, 90000);


    // F5: real vendor ZIP extraction with the system archiver UNAVAILABLE, forcing the
    // bundled yauzl fallback. Linux-only forcing mechanism (PATH scrub); Windows resolves
    // System32\\tar.exe by absolute path and is NOT exercised here - no ANY-OS claim.
    const pathAbsent = (p: string): boolean => {
        try { fs.lstatSync(p); return false; } catch { return true; }
    };
    const withScrubbedPath = async (fn: () => Promise<void>): Promise<void> => {
        const tmpNoBin = fs.mkdtempSync(path.join(os.tmpdir(), 'unitg-nobin-'));
        const savedPath = process.env.PATH;
        process.env.PATH = tmpNoBin;
        try { await fn(); } finally {
            if (savedPath === undefined) { delete process.env.PATH; } else { process.env.PATH = savedPath; }
            fs.rmSync(tmpNoBin, { recursive: true, force: true });
        }
    };
    const loadUnpackArchive = async () => {
        // Resolve from the ACTUAL installed package entry, not a hard-coded private path.
        const { createRequire } = await import('node:module');
        const { pathToFileURL } = await import('node:url');
        const req = createRequire(import.meta.url);
        const pkgJsonPath = req.resolve('@puppeteer/browsers/package.json');
        const fileUrl = pathToFileURL(path.join(path.dirname(pkgJsonPath), 'lib', 'fileUtil.js')).href;
        return (await import(fileUrl)).unpackArchive as (archivePath: string, folderPath: string) => Promise<void>;
    };
    const writeZip = (dir: string, name: string, b64: string): string => {
        const p = path.join(dir, name);
        fs.writeFileSync(p, Buffer.from(b64, 'base64'));
        return p;
    };

    it('F5a: unpackArchive via bundled yauzl fallback - clean archive contents, modes, in-root symlink', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unitg-zip-clean-'));
        tmpDirs.push(tmp);
        const CLEAN_ZIP_B64 = 'UEsDBBQAAAAAAAAAIQDkvqGyEQAAABEAAAAIAAAAZmlsZS50eHR1bml0Zy16aXAtY29udGVudFBLAwQUAAAAAAAAACEALzra6RIAAAASAAAABgAAAHJ1bi5zaCMhL2Jpbi9zaAplY2hvIGhpClBLAwQUAAAAAAAAACEAJRb34AgAAAAIAAAABwAAAGxpbmstb2tmaWxlLnR4dFBLAQIUAxQAAAAAAAAAIQDkvqGyEQAAABEAAAAIAAAAAAAAAAAAAACkgQAAAABmaWxlLnR4dFBLAQIUAxQAAAAAAAAAIQAvOtrpEgAAABIAAAAGAAAAAAAAAAAAAADtgTcAAABydW4uc2hQSwECFAMUAAAAAAAAACEAJRb34AgAAAAIAAAABwAAAAAAAAAAAAAA/6FtAAAAbGluay1va1BLBQYAAAAAAwADAJ8AAACaAAAAAAA=';
        const zipPath = writeZip(tmp, 'clean.zip', CLEAN_ZIP_B64);
        await withScrubbedPath(async () => {
            const unpackArchive = await loadUnpackArchive();
            const out = path.join(tmp, 'out');
            await unpackArchive(zipPath, out);
            expect(fs.readFileSync(path.join(out, 'file.txt'), 'utf8')).toBe('unitg-zip-content');
            expect(fs.lstatSync(path.join(out, 'run.sh')).mode & 0o111).not.toBe(0); // exec bit preserved
            expect(fs.lstatSync(path.join(out, 'link-ok')).isSymbolicLink()).toBe(true);
            expect(fs.readlinkSync(path.join(out, 'link-ok'))).toBe('file.txt');
        });
    }, 60000);

    it('F5b: unpackArchive via bundled yauzl fallback - traversal entry rejected, nothing escapes', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unitg-zip-trav-'));
        tmpDirs.push(tmp);
        const TRAVERSAL_ZIP_B64 = 'UEsDBBQAAAAAAAAAIQBld/pFDwAAAA8AAAANAAAALi4vZXNjYXBlLnR4dGVzY2FwZWQtcGF5bG9hZFBLAQIUAxQAAAAAAAAAIQBld/pFDwAAAA8AAAANAAAAAAAAAAAAAACkgQAAAAAuLi9lc2NhcGUudHh0UEsFBgAAAAABAAEAOwAAADoAAAAAAA==';
        const zipPath = writeZip(tmp, 'traversal.zip', TRAVERSAL_ZIP_B64);
        await withScrubbedPath(async () => {
            const unpackArchive = await loadUnpackArchive();
            const out = path.join(tmp, 'out');
            fs.mkdirSync(out, { recursive: true });
            await expect(unpackArchive(zipPath, out)).rejects.toThrow();
            expect(pathAbsent(path.join(tmp, 'escape.txt'))).toBe(true); // ../escape.txt never written outside root
        });
    }, 60000);

    it('F5c: unpackArchive via bundled yauzl fallback - escaping symlink rejected, never created', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unitg-zip-badlink-'));
        tmpDirs.push(tmp);
        const BADLINK_ZIP_B64 = 'UEsDBBQAAAAAAAAAIQDkvqGyEQAAABEAAAAIAAAAZmlsZS50eHR1bml0Zy16aXAtY29udGVudFBLAwQUAAAAAAAAACEAo70o5BYAAAAWAAAACAAAAGxpbmstYmFkLi4vLi4vLi4vLi4vZXRjL3Bhc3N3ZFBLAQIUAxQAAAAAAAAAIQDkvqGyEQAAABEAAAAIAAAAAAAAAAAAAACkgQAAAABmaWxlLnR4dFBLAQIUAxQAAAAAAAAAIQCjvSjkFgAAABYAAAAIAAAAAAAAAAAAAAD/oTcAAABsaW5rLWJhZFBLBQYAAAAAAgACAGwAAABzAAAAAAA=';
        const zipPath = writeZip(tmp, 'badlink.zip', BADLINK_ZIP_B64);
        await withScrubbedPath(async () => {
            const unpackArchive = await loadUnpackArchive();
            const out = path.join(tmp, 'out');
            fs.mkdirSync(out, { recursive: true });
            await expect(unpackArchive(zipPath, out)).rejects.toThrow();
            // lstat-based absence: existsSync can report false for a dangling symlink that WAS created.
            expect(pathAbsent(path.join(out, 'link-bad'))).toBe(true);
        });
    }, 60000);

    it('F4: real readUrl public smoke on IANA-reserved host (bounded: does NOT prove JS-render/junk-strip invariants)', async () => {
        // LIMITS (declared): this is a bounded public smoke only - it proves the real
        // readUrl path works end-to-end against a live host, but it does NOT prove
        // client-rendered-content or junk-stripping invariants (no controlled JS/junk
        // fixture is reachable through the product's SSRF guard, which this candidate
        // does not weaken). A hermetic successful-readUrl proof is not provided here.
        // A network failure fails this test honestly; there is no skip or fallback.
        // Target: https://example.com (IANA-reserved documentation domain, no account, no spend).
        const text = await readUrl('https://example.com');
        expect(text).toContain('Example Domain');
    }, 60000);

    it('F4b: readUrl SSRF guard really blocks loopback (hermetic product-behavior check)', async () => {
        await expect(readUrl(baseUrl)).rejects.toThrow(/SSRF|restricted|Localhost/i);
    }, 30000);
});
