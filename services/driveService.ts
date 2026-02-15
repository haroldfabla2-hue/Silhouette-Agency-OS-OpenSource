// =============================================================================
// Google Drive Service
// OAuth2 authentication and file operations for cloud storage integration
// =============================================================================

import { google, drive_v3 } from 'googleapis';
import * as fs from 'fs/promises';
import * as path from 'path';
import Database from 'better-sqlite3';

// Token storage path (encrypted in DB)
const DB_PATH = path.join(process.cwd(), 'db', 'silhouette.sqlite');

// Scopes - Drive + Gmail access
const SCOPES = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.email'
];

// Credentials from environment
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/v1/drive/callback';
const DEFAULT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

// Types
export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    size?: number;
    thumbnailLink?: string;
    webViewLink?: string;
    createdTime?: string;
    modifiedTime?: string;
}

export interface TokenData {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
    email?: string;
}

class DriveService {
    private oauth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;
    private drive: drive_v3.Drive | null = null;
    private db: Database.Database | null = null;
    private initialized = false;
    private currentEmail: string | null = null;

    /**
     * Initialize the service
     */
    async init(): Promise<void> {
        if (this.initialized) return;

        if (!CLIENT_ID || !CLIENT_SECRET) {
            console.warn('[DriveService] ⚠️ Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
            return;
        }

        // Create OAuth2 client
        this.oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

        // Setup token refresh listener
        this.oauth2Client.on('tokens', (tokens) => {
            console.log('[DriveService] 🔄 Token refreshed');
            if (tokens.refresh_token) {
                this.saveTokens({
                    access_token: tokens.access_token || '',
                    refresh_token: tokens.refresh_token,
                    expiry_date: tokens.expiry_date || Date.now() + 3600000,
                    email: this.currentEmail || undefined
                });
            }
        });

        // Initialize database for token storage
        await this.initDb();

        // Try to load existing tokens
        const existingTokens = this.loadTokens();
        if (existingTokens) {
            this.oauth2Client.setCredentials({
                access_token: existingTokens.access_token,
                refresh_token: existingTokens.refresh_token,
                expiry_date: existingTokens.expiry_date
            });
            this.currentEmail = existingTokens.email || null;
            this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
            console.log(`[DriveService] ✅ Loaded existing tokens for ${this.currentEmail}`);
        }

        this.initialized = true;
        console.log('[DriveService] ✅ Initialized');
    }

    /**
     * Initialize SQLite for token storage
     */
    private async initDb(): Promise<void> {
        await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
        this.db = new Database(DB_PATH);

        // Create tokens table if not exists
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS google_tokens (
        id INTEGER PRIMARY KEY DEFAULT 1,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expiry_date INTEGER NOT NULL,
        email TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        CHECK (id = 1)
      )
    `);
    }

    /**
     * Generate OAuth2 authorization URL
     * @param state Optional state parameter (e.g., device fingerprint) to be returned in callback
     */
    getAuthUrl(state?: string): string {
        if (!this.oauth2Client) {
            throw new Error('DriveService not initialized');
        }

        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline', // Get refresh token
            scope: SCOPES,
            prompt: 'consent', // Force consent to get refresh token
            state: state || undefined // Pass fingerprint for device registration
        });
    }

    /**
     * Exchange authorization code for tokens
     */
    async handleCallback(code: string): Promise<{ success: boolean; email?: string; error?: string }> {
        if (!this.oauth2Client) {
            return { success: false, error: 'DriveService not initialized' };
        }

        try {
            const { tokens } = await this.oauth2Client.getToken(code);

            if (!tokens.refresh_token) {
                return { success: false, error: 'No refresh token received. Try revoking access and re-authorizing.' };
            }

            this.oauth2Client.setCredentials(tokens);
            this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });

            // Get user email
            const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
            const userInfo = await oauth2.userinfo.get();
            const email = userInfo.data.email || undefined;
            this.currentEmail = email || null;

            // Save tokens
            this.saveTokens({
                access_token: tokens.access_token || '',
                refresh_token: tokens.refresh_token,
                expiry_date: tokens.expiry_date || Date.now() + 3600000,
                email
            });

            console.log(`[DriveService] ✅ Authenticated as ${email}`);
            return { success: true, email };

        } catch (error: any) {
            console.error('[DriveService] ❌ Auth failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if authenticated
     */
    isAuthenticated(): boolean {
        return this.drive !== null && this.loadTokens() !== null;
    }

    /**
     * Get current user email
     */
    getCurrentUser(): string | null {
        return this.currentEmail;
    }

    /**
     * Save tokens to database
     */
    private saveTokens(tokens: TokenData): void {
        if (!this.db) return;

        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO google_tokens (id, access_token, refresh_token, expiry_date, email, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)
    `);

        stmt.run(
            tokens.access_token,
            tokens.refresh_token,
            tokens.expiry_date,
            tokens.email || null,
            Date.now()
        );
    }

    /**
     * Load tokens from database
     */
    private loadTokens(): TokenData | null {
        if (!this.db) return null;

        try {
            const row = this.db.prepare('SELECT * FROM google_tokens WHERE id = 1').get() as any;
            if (!row) return null;

            return {
                access_token: row.access_token,
                refresh_token: row.refresh_token,
                expiry_date: row.expiry_date,
                email: row.email
            };
        } catch {
            return null;
        }
    }

    /**
     * Revoke access and delete tokens
     */
    async revoke(): Promise<boolean> {
        if (!this.oauth2Client) return false;

        try {
            const tokens = this.loadTokens();
            if (tokens?.access_token) {
                await this.oauth2Client.revokeToken(tokens.access_token);
            }
        } catch (e) {
            console.warn('[DriveService] Revoke warning:', e);
        }

        // Clear local tokens
        if (this.db) {
            this.db.prepare('DELETE FROM google_tokens WHERE id = 1').run();
        }

        this.drive = null;
        this.currentEmail = null;

        console.log('[DriveService] 🚪 Access revoked');
        return true;
    }

    // ===========================================================================
    // FILE OPERATIONS
    // ===========================================================================

    // ===========================================================================
    // PUBLIC METHODS (GUARDED)
    // ===========================================================================

    /**
     * List files safely
     */
    async listFiles(options?: {
        query?: string;
        mimeType?: string;
        pageSize?: number;
        folderId?: string;
    }): Promise<DriveFile[]> {
        const { CredentialGuard } = await import('./security/credentialGuard');

        return await CredentialGuard.protect('GoogleDrive', 'GOOGLE_CLIENT_ID', async () => {
            if (!this.drive) {
                // Try to init if not ready
                await this.init();
                if (!this.drive) throw new Error('Drive not authenticated. Please Connect Account.');
            }

            const queries: string[] = [];

            if (options?.query) {
                queries.push(`name contains '${options.query}'`);
            }

            if (options?.mimeType) {
                queries.push(`mimeType = '${options.mimeType}'`);
            }

            const folderId = options?.folderId || DEFAULT_FOLDER_ID;
            if (folderId) {
                queries.push(`'${folderId}' in parents`);
            }

            queries.push('trashed = false');

            const response = await this.drive.files.list({
                q: queries.join(' and '),
                pageSize: options?.pageSize || 50,
                fields: 'files(id, name, mimeType, size, thumbnailLink, webViewLink, createdTime, modifiedTime)'
            });

            return (response.data.files || []).map(f => ({
                id: f.id || '',
                name: f.name || '',
                mimeType: f.mimeType || '',
                size: f.size ? parseInt(f.size) : undefined,
                thumbnailLink: f.thumbnailLink || undefined,
                webViewLink: f.webViewLink || undefined,
                createdTime: f.createdTime || undefined,
                modifiedTime: f.modifiedTime || undefined
            }));
        }, []) || []; // Fallback to empty array
    }

    /**
     * Upload content safely
     */
    async uploadContent(
        content: string | Buffer,
        fileName: string,
        mimeType: string = 'application/json',
        folderId?: string
    ): Promise<DriveFile | null> {
        const { CredentialGuard } = await import('./security/credentialGuard');

        return await CredentialGuard.protect('GoogleDrive', 'GOOGLE_CLIENT_ID', async () => {
            if (!this.drive) {
                await this.init();
                if (!this.drive) throw new Error('Drive not authenticated');
            }

            const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
            const targetFolderId = folderId || DEFAULT_FOLDER_ID || undefined;

            const fileMetadata: drive_v3.Schema$File = {
                name: fileName,
                parents: targetFolderId ? [targetFolderId] : undefined
            };

            const response = await this.drive.files.create({
                requestBody: fileMetadata,
                media: {
                    mimeType,
                    body: require('stream').Readable.from(buffer)
                },
                fields: 'id, name, mimeType, size, webViewLink'
            });

            if (!response.data.id) return null;

            console.log(`[DriveService] ⬆️ Uploaded content: ${fileName}`);

            return {
                id: response.data.id,
                name: response.data.name || fileName,
                mimeType: response.data.mimeType || mimeType,
                size: response.data.size ? parseInt(response.data.size) : undefined,
                webViewLink: response.data.webViewLink || undefined
            };
        }, null) || null;
    }

    /**
     * Create folder safely
     */
    async createFolder(name: string, parentId?: string): Promise<string | null> {
        const { CredentialGuard } = await import('./security/credentialGuard');

        return await CredentialGuard.protect('GoogleDrive', 'GOOGLE_CLIENT_ID', async () => {
            if (!this.drive) throw new Error('Drive not authenticated');

            const response = await this.drive.files.create({
                requestBody: {
                    name,
                    mimeType: 'application/vnd.google-apps.folder',
                    parents: parentId ? [parentId] : undefined
                },
                fields: 'id'
            });

            console.log(`[DriveService] 📁 Created folder: ${name}`);
            return response.data.id || null;
        }, null) || null;
    }

    // Download file to local path
    async downloadFile(fileId: string, destPath: string): Promise<boolean> {
        const { CredentialGuard } = await import('./security/credentialGuard');

        return await CredentialGuard.protect('GoogleDrive', 'GOOGLE_CLIENT_ID', async () => {
            if (!this.drive) {
                await this.init();
                if (!this.drive) throw new Error('Drive not authenticated');
            }

            const fs = await import('fs');
            const response = await this.drive.files.get(
                { fileId, alt: 'media' },
                { responseType: 'stream' }
            );

            const dest = fs.createWriteStream(destPath);
            return new Promise<boolean>((resolve, reject) => {
                (response.data as any)
                    .on('end', () => resolve(true))
                    .on('error', (err: Error) => reject(err))
                    .pipe(dest);
            });
        }, false) || false;
    }

    // Delete file
    async deleteFile(fileId: string): Promise<boolean> {
        const { CredentialGuard } = await import('./security/credentialGuard');

        return await CredentialGuard.protect('GoogleDrive', 'GOOGLE_CLIENT_ID', async () => {
            if (!this.drive) {
                await this.init();
                if (!this.drive) throw new Error('Drive not authenticated');
            }

            await this.drive.files.delete({ fileId });
            console.log(`[DriveService] 🗑️ Deleted file: ${fileId}`);
            return true;
        }, false) || false;
    }
}

// Singleton export
export const driveService = new DriveService();
