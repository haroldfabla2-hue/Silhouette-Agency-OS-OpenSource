export interface DriveUploadResponse {
    success?: boolean;
    error?: string;
    file?: { id: string; name: string; webViewLink?: string };
}

export type DriveSyncOutcome =
    | { ok: true; fileId: string; fileName: string; link?: string }
    | { ok: false; error: string; backedUpLocally: boolean };

/** Interprets an upload response; a response without success+file is a visible failure, never a silent `false`. */
export function interpretUpload(res: DriveUploadResponse | null | undefined): DriveSyncOutcome {
    if (res && res.success && res.file && res.file.id) {
        return { ok: true, fileId: res.file.id, fileName: res.file.name, link: res.file.webViewLink };
    }
    return { ok: false, error: res?.error || 'Google Drive did not confirm the upload.', backedUpLocally: false };
}

/** Versioned, collision-free file name: keeps the document id so versions of one document sort together. */
export function driveFileName(docName: string, docId: string, version: number, now: number = Date.now()): string {
    const safe = docName.replace(/[^a-zA-Z0-9]/g, '_') || 'canvas';
    return `${safe}__${docId}__v${version}__${now}.ncx`;
}
