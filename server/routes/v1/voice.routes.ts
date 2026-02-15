/**
 * Voice Routes
 * API endpoints for voice library and cloning management
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

/**
 * Multer file interface - explicitly defined for TypeScript compatibility
 * This matches the structure of files processed by multer middleware
 */
interface MulterFile {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    destination: string;
    filename: string;
    path: string;
    size: number;
}

/**
 * Extended Request interface for multer file uploads
 * This provides proper TypeScript typing for req.file
 */
interface MulterRequest extends Request {
    file?: MulterFile;
}

const router = Router();

// File upload for voice cloning
const voiceUpload = multer({
    dest: path.join(process.cwd(), 'uploads', 'voice', 'temp'),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (_req, file, cb) => {
        const allowedTypes = ['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/webm'];
        if (allowedTypes.includes(file.mimetype) || file.originalname.endsWith('.wav') || file.originalname.endsWith('.mp3')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only WAV, MP3, and WebM audio files are allowed.'));
        }
    }
});

// ==================== LIBRARY VOICES ====================

/**
 * GET /v1/voices/library
 * List all voices in the library (curated + user cloned)
 */
router.get('/library', async (_req: Request, res: Response) => {
    try {
        const { voiceLibraryService } = await import('../../../services/media/voiceLibraryService');
        const voices = await voiceLibraryService.getAllVoices();

        // Group by category
        const library = voices.filter(v => v.category === 'library');
        const cloned = voices.filter(v => v.category === 'cloned');
        const custom = voices.filter(v => v.category === 'custom');

        return res.json({
            success: true,
            total: voices.length,
            library,
            cloned,
            custom,
            downloadedCount: voices.filter(v => v.isDownloaded).length
        });
    } catch (error: any) {
        console.error('[VOICE_ROUTES] Error listing voices:', error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /v1/voices/library/language/:lang
 * Get voices by language
 */
router.get('/library/language/:lang', async (req: Request, res: Response) => {
    try {
        const { voiceLibraryService } = await import('../../../services/media/voiceLibraryService');
        const voices = await voiceLibraryService.getVoicesByLanguage(req.params.lang);
        return res.json({ success: true, voices });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /v1/voices/library/download/:id
 * Download a voice from the library
 */
router.post('/library/download/:id', async (req: Request, res: Response) => {
    try {
        const { voiceLibraryService } = await import('../../../services/media/voiceLibraryService');
        const result = await voiceLibraryService.downloadVoice(req.params.id);

        if (result.success) {
            return res.json({ success: true, message: 'Voice downloaded successfully' });
        } else {
            return res.status(400).json({ success: false, error: result.error });
        }
    } catch (error: any) {
        console.error('[VOICE_ROUTES] Error downloading voice:', error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /v1/voices/library/download-all
 * Download all library voices
 */
router.post('/library/download-all', async (_req: Request, res: Response) => {
    try {
        const { voiceLibraryService } = await import('../../../services/media/voiceLibraryService');

        // This could take a while, so we respond immediately and process in background
        res.json({ success: true, message: 'Download started. Voices will be available shortly.' });

        // Download in background
        voiceLibraryService.downloadAllVoices((current, total, name) => {
            console.log(`[VOICE_ROUTES] Downloading ${current}/${total}: ${name}`);
        }).catch(err => {
            console.error('[VOICE_ROUTES] Background download failed:', err);
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// ==================== INDIVIDUAL VOICE ====================

/**
 * GET /v1/voices/:id
 * Get details of a specific voice
 */
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { voiceLibraryService } = await import('../../../services/media/voiceLibraryService');
        const voice = await voiceLibraryService.getVoice(req.params.id);

        if (!voice) {
            return res.status(404).json({ error: 'Voice not found' });
        }

        return res.json({ success: true, voice });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /v1/voices/:id
 * Delete a user voice (only cloned/custom voices)
 */
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { voiceLibraryService } = await import('../../../services/media/voiceLibraryService');
        const result = await voiceLibraryService.deleteVoice(req.params.id);

        if (result.success) {
            return res.json({ success: true, message: 'Voice deleted' });
        } else {
            return res.status(400).json({ success: false, error: result.error });
        }
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /v1/voices/:id/set-default
 * Set a voice as the default
 */
router.post('/:id/set-default', async (req: Request, res: Response) => {
    try {
        const { voiceLibraryService } = await import('../../../services/media/voiceLibraryService');
        await voiceLibraryService.setDefaultVoice(req.params.id);
        return res.json({ success: true, message: 'Default voice updated' });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /v1/voices/:id/sample
 * Get the audio sample for a voice (stream)
 */
router.get('/:id/sample', async (req: Request, res: Response) => {
    try {
        const { voiceLibraryService } = await import('../../../services/media/voiceLibraryService');
        const samplePath = await voiceLibraryService.getVoiceSamplePath(req.params.id);

        if (!samplePath || !fs.existsSync(samplePath)) {
            return res.status(404).json({ error: 'Voice sample not found or not downloaded' });
        }

        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Disposition', `inline; filename="${req.params.id}.wav"`);

        const stream = fs.createReadStream(samplePath);
        stream.pipe(res);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// ==================== VOICE CLONING ====================

/**
 * POST /v1/voices/clone
 * Clone a voice from uploaded audio
 */
router.post('/clone', voiceUpload.single('audio'), async (req: MulterRequest, res: Response) => {
    try {
        const { voiceLibraryService } = await import('../../../services/media/voiceLibraryService');
        const { processVoiceFile } = await import('../../../utils/audioConverter');

        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        const { name, language = 'es' } = req.body;

        if (!name) {
            // Clean up temp file
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Voice name is required' });
        }

        // Generate unique voice ID
        const voiceId = `cloned_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const outputPath = path.join(process.cwd(), 'uploads', 'voice', 'cloned', `${voiceId}.wav`);

        // Process and convert audio file to standard WAV format
        console.log(`[VOICE_CLONE] Processing ${req.file.originalname} for voice: ${name}`);
        const result = await processVoiceFile(req.file.path, outputPath);

        if (!result.success) {
            // Clean up temp file
            fs.unlinkSync(req.file.path);
            return res.status(400).json({
                error: `Audio processing failed: ${result.error}`
            });
        }

        // Add the cloned voice to library
        const voice = await voiceLibraryService.addClonedVoice(
            name,
            outputPath,
            language,
            {
                originalFilename: req.file.originalname,
                fileSize: req.file.size,
                mimeType: req.file.mimetype,
                voiceId
            }
        );

        // Clean up temp file
        fs.unlinkSync(req.file.path);

        return res.json({
            success: true,
            message: 'Voice cloned successfully',
            voice
        });
    } catch (error: any) {
        console.error('[VOICE_ROUTES] Clone failed:', error);

        // Clean up temp file if it exists
        if (req.file?.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /v1/voices/clone/analyze
 * Analyze audio quality before cloning
 */
router.post('/clone/analyze', voiceUpload.single('audio'), async (req: MulterRequest, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        // Get file stats
        const stats = fs.statSync(req.file.path);
        const fileSizeMB = stats.size / (1024 * 1024);

        // Basic analysis (more advanced analysis would be done by Python service)
        const analysis = {
            filename: req.file.originalname,
            fileSize: `${fileSizeMB.toFixed(2)} MB`,
            mimeType: req.file.mimetype,
            isValidFormat: ['audio/wav', 'audio/wave', 'audio/x-wav'].includes(req.file.mimetype),
            recommendations: [] as string[]
        };

        // Add recommendations
        if (fileSizeMB < 0.1) {
            analysis.recommendations.push('Audio file is very small. Consider recording for at least 6 seconds.');
        }
        if (fileSizeMB > 10) {
            analysis.recommendations.push('Audio file is large. Processing may take longer.');
        }
        if (!analysis.isValidFormat) {
            analysis.recommendations.push('For best results, use WAV format.');
        }

        // Clean up temp file
        fs.unlinkSync(req.file.path);

        return res.json({
            success: true,
            analysis
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /v1/voices/default
 * Get the current default voice
 */
router.get('/default', async (_req: Request, res: Response) => {
    try {
        const { voiceLibraryService } = await import('../../../services/media/voiceLibraryService');
        const voice = await voiceLibraryService.getDefaultVoice();

        if (!voice) {
            return res.json({ success: true, voice: null, message: 'No default voice set' });
        }

        return res.json({ success: true, voice });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
