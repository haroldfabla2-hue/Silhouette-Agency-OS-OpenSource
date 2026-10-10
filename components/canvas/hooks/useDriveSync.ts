// =============================================================================
// Nexus Canvas - Drive Sync Hook
// Syncs canvas documents to Google Drive
// =============================================================================

import { useCallback, useState, useEffect } from 'react';
import { useCanvasStore } from '../store/useCanvasStore';
import { systemBus } from '../../../services/systemBus';
import { SystemProtocol } from '../../../types';
import { api } from '../../../utils/api';
import { interpretUpload, driveFileName, type DriveUploadResponse } from './driveSyncResult';

export const useDriveSync = () => {
    const { document, prefs } = useCanvasStore();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    // Visible sync state: the UI can show the last error instead of failing silently.
    const [syncError, setSyncError] = useState<string | null>(null);
    const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
    const [syncVersion, setSyncVersion] = useState(0);

    // Check Drive auth status on mount
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const status = await api.get('/v1/drive/status') as { authenticated: boolean };
                setIsAuthenticated(status.authenticated);
            } catch {
                setIsAuthenticated(false);
            }
        };
        checkAuth();
    }, []);

    /**
     * Sync current document to Google Drive via API
     */
    const syncToDrive = useCallback(async () => {
        if (!document) {
            console.warn('[DriveSync] No document to sync');
            setSyncError('There is no document to sync.');
            return false;
        }

        try {
            console.log('[DriveSync] ☁️ Syncing to Google Drive via API...');

            // 1. Check authentication
            const status = await api.get('/v1/drive/status') as { authenticated: boolean; email?: string };
            if (!status.authenticated) {
                console.warn('[DriveSync] ❌ Google Drive not authenticated. Redirecting to auth...');
                window.open('/v1/drive/auth', '_blank', 'width=500,height=600');
                setSyncError('Google Drive is not connected. Complete the sign-in window and sync again.');
                return false;
            }

            // 2. Get configured folder ID from backend (uses GOOGLE_DRIVE_FOLDER_ID env var)
            let folderId: string | null = null;
            try {
                const config = await api.get('/v1/system/config') as { driveConfig?: { folderId?: string } };
                folderId = config.driveConfig?.folderId || null;

                if (!folderId) {
                    console.warn('[DriveSync] ⚠️ No GOOGLE_DRIVE_FOLDER_ID configured, using root folder');
                }
            } catch (err) {
                console.warn('[DriveSync] Could not fetch config, using root folder');
            }

            // 3. Prepare document for upload
            const nextVersion = syncVersion + 1;
            const fileName = driveFileName(document.name, document.id, nextVersion);
            const docJson = JSON.stringify(document, null, 2);

            // 4. Upload to Google Drive via /upload-content endpoint
            try {
                const uploadRes = await api.post('/v1/drive/upload-content', {
                    content: docJson,
                    fileName,
                    mimeType: 'application/json',
                    folderId // Will use GOOGLE_DRIVE_FOLDER_ID if null
                }) as DriveUploadResponse;

                const outcome = interpretUpload(uploadRes);
                if (outcome.ok === false) {
                    localStorage.setItem(`canvas_backup_${document.id}`, docJson);
                    setSyncError(`${outcome.error} A local backup was kept.`);
                    return false;
                }
                if (uploadRes.file) {
                    console.log(`[DriveSync] ✅ Uploaded to Drive: ${uploadRes.file.name}`);
                    console.log(`[DriveSync] 🔗 View: ${uploadRes.file.webViewLink || 'N/A'}`);

                    // Also store in localStorage as local backup
                    localStorage.setItem(`canvas_backup_${document.id}`, docJson);

                    // Emit event for Introspection tracking
                    systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, {
                        source: 'CANVAS_DRIVE_SYNC',
                        docId: document.id,
                        docName: document.name,
                        fileName,
                        driveFileId: uploadRes.file.id,
                        folderId,
                        contentSize: docJson.length,
                        timestamp: Date.now()
                    });

                    setIsAuthenticated(true);
                    setSyncError(null);
                    setLastSyncedAt(Date.now());
                    setSyncVersion(nextVersion);
                    return true;
                }
            } catch (uploadErr: any) {
                console.error('[DriveSync] ❌ Upload failed:', uploadErr);
                // Fallback to local backup only
                localStorage.setItem(`canvas_backup_${document.id}`, docJson);
                setSyncError(`Upload to Google Drive failed (${uploadErr?.message || 'unknown error'}). A local backup was kept.`);
                console.log('[DriveSync] 💾 Saved to localStorage as fallback');
            }

            return false;
        } catch (error) {
            console.error('[DriveSync] ❌ Sync failed:', error);
            setSyncError(`Sync failed: ${(error as Error)?.message || 'unknown error'}`);
            return false;
        }
    }, [document, syncVersion]);

    /**
     * Auto-sync after autosave if enabled
     */
    const shouldAutoSync = prefs.autoSyncDrive && prefs.autosaveEnabled;

    return {
        syncToDrive,
        shouldAutoSync,
        isAuthenticated,
        syncError,
        lastSyncedAt
    };
};
