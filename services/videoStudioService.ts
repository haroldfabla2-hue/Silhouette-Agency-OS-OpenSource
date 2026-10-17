/**
 * FASE 1 VIDEO STUDIO: idea en lenguaje natural -> brief validado -> gate de aprobacion.
 *
 * Silhouette llama al orquestador generateBrief de pro-studio (LLM inyectable)
 * con su cadena de nubes GRATIS (generateTextWithCloudFallbacks, ya protegida
 * por quotaLedger PR-K). El LLM propone, validateBrief de pro-studio dispone:
 * un brief invalido NUNCA se guarda como aprobable - queda FAILED con errores.
 *
 * Gate AWAITING_SCRIPT_OK: ningun brief pasa a render sin aprobacion explicita
 * del operador (approve solo transiciona desde AWAITING_SCRIPT_OK; el render
 * llega en una fase posterior y DEBE verificar status APPROVED).
 *
 * Integracion: import DINAMICO por ruta (PRO_STUDIO_PATH). Un import estatico
 * acoplaria el build/tsc de Silhouette al checkout de pro-studio (ausente en
 * CI); el import dinamico resuelve en runtime donde pro-studio existe, y zod
 * se resuelve desde los node_modules de pro-studio. Si la ruta no existe o el
 * modulo falla, el error sube en voz alta - nunca un brief a medias.
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { pathToFileURL } from 'url';

export type BriefStatus = 'AWAITING_SCRIPT_OK' | 'APPROVED' | 'REJECTED' | 'FAILED';

export interface VideoBriefRow {
    id: string;
    idea: string;
    brief_json: string | null;
    status: BriefStatus;
    errors: string;
    attempts: number;
    created_at: number;
    updated_at: number;
}

const DB_PATH = process.env.SILHOUETTE_DB_PATH
    ? path.resolve(process.env.SILHOUETTE_DB_PATH)
    : path.resolve(process.cwd(), 'db', 'silhouette.sqlite');

function proStudioPath(): string {
    return (process.env.PRO_STUDIO_PATH || '/root/rea-targets/pro-studio').trim();
}

export class VideoStudioService {
    private readonly db: Database.Database;

    constructor(dbPath: string = DB_PATH) {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
        this.db.exec(`CREATE TABLE IF NOT EXISTS video_briefs (
            id TEXT PRIMARY KEY,
            idea TEXT NOT NULL,
            brief_json TEXT,
            status TEXT NOT NULL,
            errors TEXT NOT NULL DEFAULT '[]',
            attempts INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )`);
    }

    /**
     * Genera un brief desde una idea. Cadena gratis via pro-studio
     * generateBrief; resultado honesto: ok -> AWAITING_SCRIPT_OK, no-ok -> FAILED.
     */
    async generateBriefFromIdea(idea: string): Promise<VideoBriefRow> {
        if (!idea || !idea.trim()) throw new Error('idea is required');

        const modulePath = path.join(proStudioPath(), 'src', 'brief', 'generateBrief.ts');
        if (!fs.existsSync(modulePath)) {
            throw new Error(`pro-studio generateBrief not found at ${modulePath} (set PRO_STUDIO_PATH)`);
        }
        const mod = await import(pathToFileURL(modulePath).href);
        const { generateTextWithCloudFallbacks } = await import('./geminiService');

        const result = await mod.generateBrief(idea.trim(), generateTextWithCloudFallbacks);

        const now = Date.now();
        const row: VideoBriefRow = {
            id: 'brief_' + crypto.randomBytes(8).toString('hex'),
            idea: idea.trim(),
            brief_json: result.ok ? JSON.stringify(result.brief) : null,
            status: result.ok ? 'AWAITING_SCRIPT_OK' : 'FAILED',
            errors: JSON.stringify(result.errors || []),
            attempts: result.attempts || 0,
            created_at: now,
            updated_at: now
        };
        this.db.prepare(`INSERT INTO video_briefs
            (id, idea, brief_json, status, errors, attempts, created_at, updated_at)
            VALUES (@id, @idea, @brief_json, @status, @errors, @attempts, @created_at, @updated_at)`).run(row);
        return row;
    }

    getBrief(id: string): VideoBriefRow | null {
        return (this.db.prepare('SELECT * FROM video_briefs WHERE id = ?').get(id) as VideoBriefRow) || null;
    }

    listBriefs(limit: number = 20): VideoBriefRow[] {
        return this.db.prepare('SELECT * FROM video_briefs ORDER BY created_at DESC LIMIT ?').all(limit) as VideoBriefRow[];
    }

    /** Gate: approve solo desde AWAITING_SCRIPT_OK. Otra transicion = error en voz alta. */
    approve(id: string): VideoBriefRow {
        return this.transition(id, 'APPROVED');
    }

    reject(id: string): VideoBriefRow {
        return this.transition(id, 'REJECTED');
    }

    private transition(id: string, target: BriefStatus): VideoBriefRow {
        const row = this.getBrief(id);
        if (!row) throw new Error(`brief not found: ${id}`);
        if (row.status !== 'AWAITING_SCRIPT_OK') {
            throw new Error(`cannot move brief ${id} from ${row.status} to ${target}: only AWAITING_SCRIPT_OK is actionable`);
        }
        this.db.prepare('UPDATE video_briefs SET status = ?, updated_at = ? WHERE id = ?')
            .run(target, Date.now(), id);
        return this.getBrief(id)!;
    }
}

export const videoStudioService = new VideoStudioService();
