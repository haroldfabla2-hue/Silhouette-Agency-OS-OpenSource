// =============================================================================
// Identity Service
// User authentication, device recognition, and session management
// =============================================================================

import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'db', 'silhouette.sqlite');

// Creator emails with absolute permissions (hardcoded for security)
const CREATOR_EMAILS = ['alberto.farah.b@gmail.com'];

// Role hierarchy
export enum UserRole {
    CREATOR = 'CREATOR',   // Absolute permissions, can modify Silhouette itself
    ADMIN = 'ADMIN',       // Full app access, cannot modify code
    USER = 'USER'          // Standard access
}

export interface User {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string;
    role: UserRole;
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
        this.initialized = true;

        console.log('[IdentityService] ✅ Initialized');
    }

    /**
     * Create required tables
     */
    private createTables(): void {
        if (!this.db) return;

        // Users table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        avatar_url TEXT,
        role TEXT NOT NULL DEFAULT 'USER',
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
     * Create or update user after Google OAuth
     */
    async upsertUser(googleUser: {
        email: string;
        name: string;
        avatarUrl?: string;
    }): Promise<User> {
        if (!this.db) throw new Error('IdentityService not initialized');

        const now = Date.now();
        const existingUser = this.getUserByEmail(googleUser.email);

        if (existingUser) {
            // Update last login
            this.db.prepare(`
        UPDATE users SET last_login = ?, name = ?, avatar_url = ? WHERE id = ?
      `).run(now, googleUser.name, googleUser.avatarUrl || null, existingUser.id);

            existingUser.lastLogin = now;
            existingUser.name = googleUser.name;
            existingUser.avatarUrl = googleUser.avatarUrl;

            this.currentUser = existingUser;
            return existingUser;
        }

        // Create new user
        const id = crypto.randomUUID();
        const role = CREATOR_EMAILS.includes(googleUser.email) ? UserRole.CREATOR : UserRole.USER;

        this.db.prepare(`
      INSERT INTO users (id, email, name, avatar_url, role, created_at, last_login)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, googleUser.email, googleUser.name, googleUser.avatarUrl || null, role, now, now);

        const user: User = {
            id,
            email: googleUser.email,
            name: googleUser.name,
            avatarUrl: googleUser.avatarUrl,
            role,
            createdAt: now,
            lastLogin: now
        };

        this.currentUser = user;

        console.log(`[IdentityService] 👤 Created user: ${googleUser.email} (${role})`);
        return user;
    }

    /**
     * Get user by email
     */
    getUserByEmail(email: string): User | null {
        if (!this.db) return null;

        const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
        if (!row) return null;

        return {
            id: row.id,
            email: row.email,
            name: row.name,
            avatarUrl: row.avatar_url,
            role: row.role as UserRole,
            createdAt: row.created_at,
            lastLogin: row.last_login
        };
    }

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

        console.log(`[IdentityService] 💻 Registered device: ${deviceName}`);
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

        const user: User = {
            id: row.id,
            email: row.email,
            name: row.name,
            avatarUrl: row.avatar_url,
            role: row.role as UserRole,
            createdAt: row.created_at,
            lastLogin: row.last_login
        };

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

        console.log(`[IdentityService] 🔓 Auto-login: ${user.email} on ${row.device_name}`);
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

        console.log('[IdentityService] 🚪 Logged out');
    }

    /**
     * Get status for API response
     */
    getStatus(): {
        authenticated: boolean;
        user: User | null;
        device: Device | null;
        isCreator: boolean;
    } {
        return {
            authenticated: this.currentUser !== null,
            user: this.currentUser,
            device: this.currentDevice,
            isCreator: this.isCreator()
        };
    }
}

export const identityService = new IdentityService();
