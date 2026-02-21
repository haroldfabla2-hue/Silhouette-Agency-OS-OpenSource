// =============================================================================
// Identity Service
// User authentication, device recognition, and session management
// =============================================================================

import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'db', 'silhouette.sqlite');

// Creator emails: migrated from hardcode to env config
// Comma-separated list. First setup user always gets CREATOR role regardless.
const CREATOR_EMAILS = (process.env.CREATOR_EMAILS || 'alberto.farah.b@gmail.com')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);

// Role hierarchy
export enum UserRole {
    CREATOR = 'CREATOR',   // Absolute permissions, can modify Silhouette itself
    ADMIN = 'ADMIN',       // Full app access, cannot modify code
    USER = 'USER'          // Standard access
}

export interface User {
    id: string;
    email: string | null;
    name: string;
    avatarUrl?: string;
    role: UserRole;
    googleLinked: boolean;
    createdAt: number;
    lastLogin: number;
}

export interface Device {
    id: string;
    userId: string;
    fingerprint: string;
    name: string;
    trusted: boolean;
    lastSeen: number;
    createdAt: number;
}

export interface Session {
    id: string;
    userId: string;
    deviceId: string;
    expiresAt: number;
    createdAt: number;
}

class IdentityService {
    private db: Database.Database | null = null;
    private initialized = false;
    private currentUser: User | null = null;
    private currentDevice: Device | null = null;
    private currentSession: Session | null = null;

    /**
     * Initialize identity service
     */
    async init(): Promise<void> {
        if (this.initialized) return;

        // Ensure directory exists
        const dbDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        this.db = new Database(DB_PATH);
        this.createTables();
        this.migrateSchema();
        this.initialized = true;

        console.log('[IdentityService] Initialized');
    }

    /**
     * Create required tables
     */
    private createTables(): void {
        if (!this.db) return;

        // Users table - email nullable for initial setup without Google
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        name TEXT NOT NULL,
        avatar_url TEXT,
        role TEXT NOT NULL DEFAULT 'USER',
        google_email TEXT,
        created_at INTEGER NOT NULL,
        last_login INTEGER NOT NULL
      )
    `);

        // Devices table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        name TEXT NOT NULL,
        trusted INTEGER NOT NULL DEFAULT 0,
        last_seen INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, fingerprint)
      )
    `);

        // Sessions table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (device_id) REFERENCES devices(id)
      )
    `);

        // Create index for faster lookups
        this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);
    }

    /**
     * Migrate schema for existing databases
     * Adds google_email column if missing (older installations)
     */
    private migrateSchema(): void {
        if (!this.db) return;

        // Add google_email column if not exists
        try {
            const columns = this.db.pragma('table_info(users)') as any[];
            const hasGoogleEmail = columns.some((c: any) => c.name === 'google_email');
            if (!hasGoogleEmail) {
                this.db.exec('ALTER TABLE users ADD COLUMN google_email TEXT');
                console.log('[IdentityService] Migrated: added google_email column');

                // Backfill google_email for existing users who logged in via Google
                this.db.exec(`
                    UPDATE users SET google_email = email
                    WHERE email IS NOT NULL AND email NOT LIKE '%@silhouette.local'
                `);
            }
        } catch {
            // Column already exists or table doesn't exist yet
        }
    }

    // ─── Setup Flow ─────────────────────────────────────────────

    /**
     * Check if any users exist (determines if setup is needed)
     */
    hasAnyUsers(): boolean {
        if (!this.db) return false;
        const row = this.db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
        return row.count > 0;
    }

    /**
     * First-time setup: create the initial CREATOR user without Google
     * The first user always gets CREATOR role.
     */
    setupFirstUser(
        name: string,
        fingerprint: string,
        deviceName: string
    ): { user: User; device: Device; session: Session } {
        if (!this.db) throw new Error('IdentityService not initialized');

        if (this.hasAnyUsers()) {
            throw new Error('Setup already completed. Users exist.');
        }

        const now = Date.now();
        const userId = crypto.randomUUID();
        // Placeholder email until Google is linked
        const placeholderEmail = `setup-${userId.slice(0, 8)}@silhouette.local`;

        this.db.prepare(`
            INSERT INTO users (id, email, name, avatar_url, role, google_email, created_at, last_login)
            VALUES (?, ?, ?, NULL, ?, NULL, ?, ?)
        `).run(userId, placeholderEmail, name, UserRole.CREATOR, now, now);

        const user: User = {
            id: userId,
            email: placeholderEmail,
            name,
            role: UserRole.CREATOR,
            googleLinked: false,
            createdAt: now,
            lastLogin: now
        };

        this.currentUser = user;

        // Register device and create session
        const device = this.registerDevice(userId, fingerprint, deviceName, true);
        const session = this.createSession(userId, device.id);

        console.log(`[IdentityService] Setup complete: ${name} (CREATOR) on ${deviceName}`);
        return { user, device, session };
    }

    // ─── Google Linking ─────────────────────────────────────────

    /**
     * Link a Google account to an existing user
     * Unlocks: Drive, Gmail, Calendar, cross-device login
     */
    linkGoogleAccount(userId: string, googleEmail: string, googleName?: string, avatarUrl?: string): User {
        if (!this.db) throw new Error('IdentityService not initialized');

        const now = Date.now();

        // Check if another user already has this Google email
        const existing = this.getUserByGoogleEmail(googleEmail);
        if (existing && existing.id !== userId) {
            throw new Error('This Google account is already linked to another user');
        }

        this.db.prepare(`
            UPDATE users
            SET email = ?, google_email = ?, avatar_url = COALESCE(?, avatar_url),
                name = COALESCE(?, name), last_login = ?
            WHERE id = ?
        `).run(googleEmail, googleEmail, avatarUrl || null, googleName || null, now, userId);

        const updated = this.getUserById(userId);
        if (!updated) throw new Error('User not found after update');

        this.currentUser = updated;
        console.log(`[IdentityService] Google linked: ${googleEmail} -> user ${userId}`);
        return updated;
    }

    /**
     * Check if current user has Google linked
     */
    isGoogleLinked(): boolean {
        return this.currentUser?.googleLinked === true;
    }

    /**
     * Get Google link status for any user by ID
     */
    getUserGoogleStatus(userId: string): { linked: boolean; email: string | null } {
        if (!this.db) return { linked: false, email: null };
        const row = this.db.prepare('SELECT google_email FROM users WHERE id = ?').get(userId) as any;
        return {
            linked: !!row?.google_email,
            email: row?.google_email || null
        };
    }

    // ─── User CRUD ──────────────────────────────────────────────

    /**
     * Create or update user after Google OAuth
     */
    async upsertUser(googleUser: {
        email: string;
        name: string;
        avatarUrl?: string;
    }): Promise<User> {
        if (!this.db) throw new Error('IdentityService not initialized');

        const now = Date.now();

        // Check if this Google email is already linked to a user
        const existingByGoogle = this.getUserByGoogleEmail(googleUser.email);
        if (existingByGoogle) {
            // Update last login
            this.db.prepare(`
                UPDATE users SET last_login = ?, name = ?, avatar_url = ? WHERE id = ?
            `).run(now, googleUser.name, googleUser.avatarUrl || null, existingByGoogle.id);

            existingByGoogle.lastLogin = now;
            existingByGoogle.name = googleUser.name;
            existingByGoogle.avatarUrl = googleUser.avatarUrl;

            this.currentUser = existingByGoogle;
            return existingByGoogle;
        }

        // Fallback: check by regular email (backward compat with pre-migration users)
        const existingByEmail = this.getUserByEmail(googleUser.email);
        if (existingByEmail) {
            // Link Google and update
            this.db.prepare(`
                UPDATE users SET last_login = ?, name = ?, avatar_url = ?, google_email = ? WHERE id = ?
            `).run(now, googleUser.name, googleUser.avatarUrl || null, googleUser.email, existingByEmail.id);

            existingByEmail.lastLogin = now;
            existingByEmail.name = googleUser.name;
            existingByEmail.avatarUrl = googleUser.avatarUrl;
            existingByEmail.googleLinked = true;

            this.currentUser = existingByEmail;
            return existingByEmail;
        }

        // Create new user
        const id = crypto.randomUUID();
        const isFirstUser = !this.hasAnyUsers();
        let role: UserRole;

        if (isFirstUser) {
            role = UserRole.CREATOR;
        } else if (CREATOR_EMAILS.includes(googleUser.email)) {
            role = UserRole.CREATOR;
        } else {
            role = UserRole.USER;
        }

        this.db.prepare(`
            INSERT INTO users (id, email, name, avatar_url, role, google_email, created_at, last_login)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, googleUser.email, googleUser.name, googleUser.avatarUrl || null, role, googleUser.email, now, now);

        const user: User = {
            id,
            email: googleUser.email,
            name: googleUser.name,
            avatarUrl: googleUser.avatarUrl,
            role,
            googleLinked: true,
            createdAt: now,
            lastLogin: now
        };

        this.currentUser = user;

        console.log(`[IdentityService] Created user: ${googleUser.email} (${role})`);
        return user;
    }

    /**
     * Get user by email
     */
    getUserByEmail(email: string): User | null {
        if (!this.db) return null;

        const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
        if (!row) return null;

        return this.rowToUser(row);
    }

    /**
     * Get user by Google email
     */
    getUserByGoogleEmail(googleEmail: string): User | null {
        if (!this.db) return null;

        const row = this.db.prepare('SELECT * FROM users WHERE google_email = ?').get(googleEmail) as any;
        if (!row) return null;

        return this.rowToUser(row);
    }

    /**
     * Get user by ID
     */
    getUserById(userId: string): User | null {
        if (!this.db) return null;

        const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
        if (!row) return null;

        return this.rowToUser(row);
    }

    /**
     * Convert database row to User object
     */
    private rowToUser(row: any): User {
        return {
            id: row.id,
            email: row.email,
            name: row.name,
            avatarUrl: row.avatar_url,
            role: row.role as UserRole,
            googleLinked: !!row.google_email,
            createdAt: row.created_at,
            lastLogin: row.last_login
        };
    }

    /**
     * Get creator's display name (for dynamic prompts)
     */
    getCreatorName(): string | null {
        if (!this.db) return null;

        const row = this.db.prepare(
            "SELECT name FROM users WHERE role = 'CREATOR' LIMIT 1"
        ).get() as any;

        return row?.name || null;
    }

    // ─── Devices ────────────────────────────────────────────────

    /**
     * Register a device for a user
     */
    registerDevice(userId: string, fingerprint: string, deviceName: string, trusted = true): Device {
        if (!this.db) throw new Error('IdentityService not initialized');

        const now = Date.now();
        const existingDevice = this.getDeviceByFingerprint(fingerprint, userId);

        if (existingDevice) {
            // Update last seen
            this.db.prepare('UPDATE devices SET last_seen = ?, trusted = ? WHERE id = ?')
                .run(now, trusted ? 1 : 0, existingDevice.id);

            existingDevice.lastSeen = now;
            existingDevice.trusted = trusted;
            this.currentDevice = existingDevice;
            return existingDevice;
        }

        const id = crypto.randomUUID();

        this.db.prepare(`
      INSERT INTO devices (id, user_id, fingerprint, name, trusted, last_seen, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, fingerprint, deviceName, trusted ? 1 : 0, now, now);

        const device: Device = {
            id,
            userId,
            fingerprint,
            name: deviceName,
            trusted,
            lastSeen: now,
            createdAt: now
        };

        this.currentDevice = device;

        console.log(`[IdentityService] Registered device: ${deviceName}`);
        return device;
    }

    /**
     * Get device by fingerprint
     */
    getDeviceByFingerprint(fingerprint: string, userId?: string): Device | null {
        if (!this.db) return null;

        let query = 'SELECT * FROM devices WHERE fingerprint = ?';
        const params: any[] = [fingerprint];

        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }

        const row = this.db.prepare(query).get(...params) as any;
        if (!row) return null;

        return {
            id: row.id,
            userId: row.user_id,
            fingerprint: row.fingerprint,
            name: row.name,
            trusted: row.trusted === 1,
            lastSeen: row.last_seen,
            createdAt: row.created_at
        };
    }

    // ─── Sessions & Auto-login ──────────────────────────────────

    /**
     * Try auto-login using device fingerprint
     */
    async tryAutoLogin(fingerprint: string): Promise<User | null> {
        if (!this.db) return null;

        // Find trusted device with this fingerprint
        const row = this.db.prepare(`
      SELECT u.*, d.id as device_id, d.name as device_name, d.trusted
      FROM devices d
      JOIN users u ON d.user_id = u.id
      WHERE d.fingerprint = ? AND d.trusted = 1
    `).get(fingerprint) as any;

        if (!row) return null;

        const user = this.rowToUser(row);

        // Update last login
        const now = Date.now();
        this.db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now, user.id);
        this.db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(now, row.device_id);

        this.currentUser = user;
        this.currentDevice = {
            id: row.device_id,
            userId: user.id,
            fingerprint,
            name: row.device_name,
            trusted: true,
            lastSeen: now,
            createdAt: row.created_at
        };

        console.log(`[IdentityService] Auto-login: ${user.name} on ${row.device_name}`);
        return user;
    }

    /**
     * Create a new session
     */
    createSession(userId: string, deviceId: string, durationMs = 30 * 24 * 60 * 60 * 1000): Session {
        if (!this.db) throw new Error('IdentityService not initialized');

        const now = Date.now();
        const id = crypto.randomUUID();
        const expiresAt = now + durationMs;

        // Clean up old sessions for this device
        this.db.prepare('DELETE FROM sessions WHERE device_id = ?').run(deviceId);

        this.db.prepare(`
      INSERT INTO sessions (id, user_id, device_id, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, deviceId, expiresAt, now);

        const session: Session = {
            id,
            userId,
            deviceId,
            expiresAt,
            createdAt: now
        };

        this.currentSession = session;
        return session;
    }

    // ─── Accessors ──────────────────────────────────────────────

    /**
     * Get current user
     */
    getCurrentUser(): User | null {
        return this.currentUser;
    }

    /**
     * Get current device
     */
    getCurrentDevice(): Device | null {
        return this.currentDevice;
    }

    /**
     * Check if current user is creator
     */
    isCreator(): boolean {
        return this.currentUser?.role === UserRole.CREATOR;
    }

    /**
     * Check if current user has at least admin role
     */
    isAdmin(): boolean {
        return this.currentUser?.role === UserRole.CREATOR ||
            this.currentUser?.role === UserRole.ADMIN;
    }

    /**
     * Logout - clear current session
     */
    logout(): void {
        if (this.currentSession && this.db) {
            this.db.prepare('DELETE FROM sessions WHERE id = ?').run(this.currentSession.id);
        }

        this.currentUser = null;
        this.currentDevice = null;
        this.currentSession = null;

        console.log('[IdentityService] Logged out');
    }

    /**
     * Get status for API response
     */
    getStatus(): {
        authenticated: boolean;
        user: User | null;
        device: Device | null;
        isCreator: boolean;
        googleLinked: boolean;
    } {
        return {
            authenticated: this.currentUser !== null,
            user: this.currentUser,
            device: this.currentDevice,
            isCreator: this.isCreator(),
            googleLinked: this.isGoogleLinked()
        };
    }
}

export const identityService = new IdentityService();
