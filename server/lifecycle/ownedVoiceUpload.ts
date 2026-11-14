import type { Request } from 'express';
import type { Readable, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { createWriteStream, promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const localRequire = createRequire(import.meta.url);
const randomName = promisify(randomBytes);
type UploadedFile = { fieldname: string; originalname: string; encoding: string; mimetype: string;
    destination: string; filename: string; path: string; size: number };
type Parser = Writable & { on(event: string, listener: (...args: any[]) => void): Parser };

/** Specific replacement for multer({dest:'uploads/temp/'}).single('file').
 * No arbitrary timeout, size cap, shutdown cancellation or detached cleanup.
 * Uses the same locked parser/field/type/error dependencies as that Multer.
 * Its private parser/storage callbacks cannot otherwise prove abort closure.
 */
export async function receiveOwnedVoiceUpload(request: Request): Promise<UploadedFile | undefined> {
    const fromMulter = createRequire(localRequire.resolve('multer'));
    const isMultipart = fromMulter('type-is') as (request: Request, types: string[]) => unknown;
    if (!isMultipart(request, ['multipart'])) return undefined;
    const Busboy = fromMulter('busboy') as (options: { headers: Request['headers'] }) => Parser;
    const appendField = fromMulter('append-field') as (body: object, field: string, value: string) => void;
    const MulterError = fromMulter('./lib/multer-error') as new (code: string, field?: string) => Error;
    const destination = 'uploads/temp/';
    request.body = Object.create(null);
    let originalError: unknown;
    const secondaryErrors: unknown[] = [];
    let failed = false;
    let parser: Parser | undefined;
    let parserFinished = false;
    let parserClosed = false;
    let selected = false;
    let result: UploadedFile | undefined;
    const writes: Promise<void>[] = [];
    const streams = new Set<Readable | Writable>();
    const createdPaths: string[] = [];
    const fail = (error: unknown) => {
        if (!failed) { failed = true; originalError = error; }
        else if (error !== originalError) secondaryErrors.push(error);
        const reason = originalError instanceof Error ? originalError : new Error('Voice upload failed', { cause: originalError });
        if (parser) { request.unpipe(parser); parser.destroy(reason); }
        for (const stream of streams) stream.destroy(reason);
    };
    const aborted = () => fail(new Error('Voice upload request aborted'));
    const requestError = (error: Error) => fail(error);
    const closed = () => { if (!request.complete && !request.readableEnded) aborted(); };
    request.on('aborted', aborted); request.on('error', requestError); request.on('close', closed);
    try {
        // Retain real directory and random-name callbacks, even across abort.
        await fs.mkdir(destination, { recursive: true });
        if (request.aborted || (request.destroyed && !request.complete)) aborted();
        if (failed) throw originalError;
        parser = Busboy({ headers: request.headers });
        const parserJoin = new Promise<void>((resolve) => {
            parser!.on('error', fail);
            parser!.on('finish', () => { parserFinished = true; });
            parser!.on('close', () => { parserClosed = true; resolve(); });
        });
        parser.on('field', (field: string | undefined, value: string, info: { nameTruncated: boolean; valueTruncated: boolean }) => {
            if (field == null) return fail(new MulterError('MISSING_FIELD_NAME'));
            if (info.nameTruncated) return fail(new MulterError('LIMIT_FIELD_KEY'));
            if (info.valueTruncated) return fail(new MulterError('LIMIT_FIELD_VALUE', field));
            try { appendField(request.body, field, value); } catch (error) { fail(error); }
        });
        parser.on('file', (field: string, input: Readable, info: { filename?: string; encoding: string; mimeType: string }) => {
            // Register close before any asynchronous filename allocation.
            streams.add(input);
            const inputClosed = new Promise<void>(resolve => input.once('close', () => { streams.delete(input); resolve(); }));
            input.on('error', fail);
            const write = (async () => {
                try {
                    if (!info.filename) { input.resume(); await inputClosed; return; }
                    if (field !== 'file' || selected) throw new MulterError('LIMIT_UNEXPECTED_FILE', field);
                    selected = true;
                    const filename = (await randomName(16)).toString('hex');
                    if (failed) { input.destroy(originalError instanceof Error ? originalError : undefined); await inputClosed; return; }
                    const filePath = path.join(destination, filename);
                    const output = createWriteStream(filePath);
                    createdPaths.push(filePath); streams.add(output);
                    const outputClosed = new Promise<void>(resolve => output.once('close', () => { streams.delete(output); resolve(); }));
                    output.on('error', fail);
                    // pipeline owns actual transfer and stream destruction. Keep both
                    // close joins even when its original promise rejects early.
                    const transfer = pipeline(input, output);
                    const transferResult = await Promise.allSettled([transfer, inputClosed, outputClosed]);
                    for (const item of transferResult) if (item.status === 'rejected') fail(item.reason);
                    if (!failed) result = { fieldname: field, originalname: info.filename, encoding: info.encoding,
                        mimetype: info.mimeType, destination, filename, path: filePath, size: output.bytesWritten };
                } catch (error) { fail(error); await inputClosed; }
            })();
            writes.push(write);
        });
        try { request.pipe(parser); } catch (error) { fail(error); }
        await parserJoin;
        // Parser closed means no new file callbacks. Do not snapshot earlier.
        await Promise.allSettled(writes);
        if (!failed && (!parserClosed || !parserFinished)) fail(new Error('Voice upload parser closed before finish'));
        if (failed) throw originalError;
        if (result) (request as Request & { file?: UploadedFile }).file = result;
        return result;
    } catch (error) {
        fail(error);
        // Original failure stays first. Real write/close/unlink callbacks all join.
        await Promise.allSettled(writes);
        const cleanup = await Promise.allSettled(createdPaths.map(async filename => {
            try { await fs.unlink(filename); }
            catch (unlinkError: any) { if (unlinkError?.code !== 'ENOENT') throw unlinkError; }
        }));
        for (const item of cleanup) if (item.status === 'rejected') secondaryErrors.push(item.reason);
        if (secondaryErrors.length) throw new AggregateError([originalError, ...secondaryErrors], 'Voice upload failed with closure/cleanup errors', { cause: originalError });
        throw originalError;
    } finally {
        // This block is not a timeout/escape: only reached after real joins.
        request.off('aborted', aborted); request.off('error', requestError); request.off('close', closed);
    }
}
