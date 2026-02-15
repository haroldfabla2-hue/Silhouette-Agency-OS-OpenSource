import { Router, Request, Response } from 'express';
import { mediaController } from '../../controllers/mediaController';

const router = Router();

// ==================== VIDEO QUEUE ====================
// POST /v1/media/queue - Queue video generation
router.post('/queue', (req, res) => mediaController.queueVideo(req, res));
// GET /v1/media/queue - Get all queued jobs
router.get('/queue', (req, res) => mediaController.getQueue(req, res));
// GET /v1/media/queue/:id - Get specific job status
router.get('/queue/:id', (req, res) => mediaController.getJobStatus(req, res));

// ==================== IMAGE GENERATION ====================
// POST /v1/media/generate/image - Generate image from prompt
router.post('/generate/image', (req, res) => mediaController.generateImage(req, res));
// POST /v1/media/enhance - Enhance existing image
router.post('/enhance', (req, res) => mediaController.enhanceImage(req, res));
// POST /v1/media/upscale - Upscale to 4K
router.post('/upscale', (req, res) => mediaController.upscale(req, res));

// ==================== COMPOSITING ====================
// POST /v1/media/composite - Real-Hybrid pipeline
router.post('/composite', (req, res) => mediaController.composite(req, res));
// POST /v1/media/critique - QA analysis
router.post('/critique', (req, res) => mediaController.critique(req, res));

// ==================== ASSET MANAGEMENT ====================
// GET /v1/media/assets - List local assets
router.get('/assets', (req, res) => mediaController.listAssets(req, res));
// GET /v1/media/search - Search stock photos
router.get('/search', (req, res) => mediaController.searchAssets(req, res));

// ==================== ASSET LIBRARY (Characters/Environments/Props) ====================
// GET /v1/media/assets/library - List all library assets
router.get('/assets/library', async (req: Request, res: Response) => {
    try {
        const { assetLibrary } = await import('../../../services/assets/assetLibrary');
        const role = req.query.role as string | undefined;

        let assets;
        if (role && ['character', 'environment', 'prop'].includes(role)) {
            assets = assetLibrary.getAssetsByRole(role as any);
        } else {
            assets = assetLibrary.getAllAssets();
        }

        return res.json({ assets, stats: assetLibrary.getStats() });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/media/assets/library - Create new asset
router.post('/assets/library', async (req: Request, res: Response) => {
    try {
        const { assetLibrary } = await import('../../../services/assets/assetLibrary');
        const { name, role, description, referenceImages, tags, style, defaultPromptPrefix } = req.body;

        if (!name || !role) {
            return res.status(400).json({ error: 'Missing name or role' });
        }

        const asset = await assetLibrary.createAsset({
            name, role, description, referenceImages, tags, style, defaultPromptPrefix
        });

        return res.json({ success: true, asset });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// PUT /v1/media/assets/library/:id - Update asset
router.put('/assets/library/:id', async (req: Request, res: Response) => {
    try {
        const { assetLibrary } = await import('../../../services/assets/assetLibrary');
        const { id } = req.params;

        const existing = assetLibrary.getAsset(id);
        if (!existing) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const updated = { ...existing, ...req.body, id };
        await assetLibrary.saveAsset(updated);

        return res.json({ success: true, asset: updated });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// DELETE /v1/media/assets/library/:id - Delete asset
router.delete('/assets/library/:id', async (req: Request, res: Response) => {
    try {
        const { assetLibrary } = await import('../../../services/assets/assetLibrary');
        const { id } = req.params;

        const success = await assetLibrary.deleteAsset(id);
        if (!success) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        return res.json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// ==================== VOICE & LIP SYNC ====================
// POST /v1/media/generate/voice - Generate speech from text (ElevenLabs)
router.post('/generate/voice', async (req: Request, res: Response) => {
    try {
        const { lipSyncService } = await import('../../../services/media/lipSyncService');
        const { text, voiceId } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Missing text' });
        }

        const result = await lipSyncService.generateSpeech(text, voiceId);
        if (result) {
            return res.json({ success: true, ...result });
        }
        return res.status(500).json({ error: 'Speech generation failed' });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// ==================== LOCAL TTS (Coqui GPU) ====================
// POST /v1/media/tts/speak - Generate speech using local engine
router.post('/tts/speak', async (req: Request, res: Response) => {
    try {
        const { ttsService } = await import('../../../services/ttsService');
        const { text } = req.body;

        if (!text) return res.status(400).json({ error: 'Missing text' });

        const url = await ttsService.speak(text);
        if (url) {
            return res.json({ success: true, url });
        }
        return res.status(500).json({ error: 'TTS failed or disabled' });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/media/tts/config
router.get('/tts/config', async (_req: Request, res: Response) => {
    try {
        const { ttsService } = await import('../../../services/ttsService');
        return res.json(ttsService.getConfig());
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/media/tts/config
router.post('/tts/config', async (req: Request, res: Response) => {
    try {
        const { ttsService } = await import('../../../services/ttsService');
        ttsService.updateConfig(req.body);
        return res.json({ success: true, config: ttsService.getConfig() });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/media/tts/sleep
router.post('/tts/sleep', async (_req: Request, res: Response) => {
    try {
        const { ttsService } = await import('../../../services/ttsService');
        await ttsService.sleep();
        return res.json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/media/tts/wake
router.post('/tts/wake', async (_req: Request, res: Response) => {
    try {
        const { ttsService } = await import('../../../services/ttsService');
        await ttsService.wake();
        return res.json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/media/tts/voices - List all voices (default + cloned)
router.get('/tts/voices', async (_req: Request, res: Response) => {
    try {
        const { ttsService } = await import('../../../services/ttsService');
        const voices = await ttsService.getVoices();
        return res.json({ voices });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/media/tts/voices/clone - Clone voice from upload
router.post('/tts/voices/clone', async (req: Request, res: Response) => {
    try {
        const { ttsService } = await import('../../../services/ttsService');
        const multer = (await import('multer')).default;
        const upload = multer({ dest: 'uploads/temp/' }).single('file');

        upload(req, res, async (err: any) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!(req as any).file) return res.status(400).json({ error: 'No file uploaded' });

            try {
                const result = await ttsService.cloneVoice((req as any).file, req.body.name);
                return res.json(result);
            } catch (e: any) {
                return res.status(500).json({ error: e.message });
            }
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/media/tts/health - Get engine status
router.get('/tts/health', async (_req: Request, res: Response) => {
    try {
        const { ttsService } = await import('../../../services/ttsService');
        return res.json(ttsService.getHealth());
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/media/lipsync - Apply lip sync to video
router.post('/lipsync', async (req: Request, res: Response) => {
    try {
        const { lipSyncService } = await import('../../../services/media/lipSyncService');
        const { videoUrl, audioUrl, text, voiceId } = req.body;

        if (!videoUrl) {
            return res.status(400).json({ error: 'Missing videoUrl' });
        }

        // If text is provided, do the full pipeline
        if (text) {
            const result = await lipSyncService.generateTalkingHead(text, videoUrl, voiceId);
            if (result) {
                return res.json({ success: true, ...result });
            }
            return res.status(500).json({ error: 'Talking head generation failed' });
        }

        // Otherwise, just apply lip sync to existing audio
        if (!audioUrl) {
            return res.status(400).json({ error: 'Missing text or audioUrl' });
        }

        const result = await lipSyncService.applyLipSync(videoUrl, audioUrl);
        if (result) {
            return res.json({ success: true, ...result });
        }
        return res.status(500).json({ error: 'Lip sync failed' });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/media/voices - List available ElevenLabs voices
router.get('/voices', async (_req: Request, res: Response) => {
    try {
        const { lipSyncService } = await import('../../../services/media/lipSyncService');
        const voices = await lipSyncService.getVoices();
        return res.json({ voices });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// ==================== BRAND MANAGEMENT ====================
// GET /v1/media/brand/:id - Load brand
router.get('/brand/:id', (req, res) => mediaController.getBrand(req, res));
// GET /v1/media/brand/:id/rules - Get brand rules
router.get('/brand/:id/rules', (req, res) => mediaController.getBrandRules(req, res));

// ==================== SYSTEM STATUS ====================
// GET /v1/media/vram-status - VRAM allocation status
router.get('/vram-status', (req, res) => mediaController.getVramStatus(req, res));
// GET /v1/media/engines - Available video engines
router.get('/engines', (req, res) => mediaController.getEngines(req, res));

// ==================== ASSET CATALOG (Unified) ====================

// GET /v1/media/catalog - List all assets with filters
router.get('/catalog', async (req: Request, res: Response) => {
    try {
        const { assetCatalog } = await import('../../../services/assetCatalog');

        const options: any = {};
        if (req.query.type) options.type = req.query.type as string;
        if (req.query.folder) options.folder = req.query.folder as string;
        if (req.query.query) options.query = req.query.query as string;
        if (req.query.tags) options.tags = (req.query.tags as string).split(',');
        if (req.query.isFavorite) options.isFavorite = req.query.isFavorite === 'true';
        if (req.query.isArchived) options.isArchived = req.query.isArchived === 'true';
        if (req.query.limit) options.limit = parseInt(req.query.limit as string);
        if (req.query.offset) options.offset = parseInt(req.query.offset as string);

        const assets = assetCatalog.search(options);
        const stats = assetCatalog.getStats();

        return res.json({ assets, stats });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/media/catalog/:id - Get single asset
router.get('/catalog/:id', async (req: Request, res: Response) => {
    try {
        const { assetCatalog } = await import('../../../services/assetCatalog');
        const asset = assetCatalog.getById(req.params.id);
        if (!asset) return res.status(404).json({ error: 'Asset not found' });
        return res.json({ asset });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// PUT /v1/media/catalog/:id - Update asset
router.put('/catalog/:id', async (req: Request, res: Response) => {
    try {
        const { assetCatalog } = await import('../../../services/assetCatalog');
        const updated = assetCatalog.update(req.params.id, req.body);
        if (!updated) return res.status(404).json({ error: 'Asset not found' });
        return res.json({ asset: updated });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// DELETE /v1/media/catalog/:id - Delete asset
router.delete('/catalog/:id', async (req: Request, res: Response) => {
    try {
        const { assetCatalog } = await import('../../../services/assetCatalog');
        const deleteFile = req.query.deleteFile === 'true';
        const success = await assetCatalog.delete(req.params.id, deleteFile);
        if (!success) return res.status(404).json({ error: 'Asset not found' });
        return res.json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/media/catalog/:id/favorite - Toggle favorite
router.post('/catalog/:id/favorite', async (req: Request, res: Response) => {
    try {
        const { assetCatalog } = await import('../../../services/assetCatalog');
        const updated = assetCatalog.toggleFavorite(req.params.id);
        if (!updated) return res.status(404).json({ error: 'Asset not found' });
        return res.json({ asset: updated });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/media/catalog/:id/archive - Archive asset
router.post('/catalog/:id/archive', async (req: Request, res: Response) => {
    try {
        const { assetCatalog } = await import('../../../services/assetCatalog');
        const updated = assetCatalog.archive(req.params.id);
        if (!updated) return res.status(404).json({ error: 'Asset not found' });
        return res.json({ asset: updated });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/media/catalog/:id/tags - Add tags
router.post('/catalog/:id/tags', async (req: Request, res: Response) => {
    try {
        const { assetCatalog } = await import('../../../services/assetCatalog');
        const { tags } = req.body;
        const updated = assetCatalog.addTags(req.params.id, tags || []);
        if (!updated) return res.status(404).json({ error: 'Asset not found' });
        return res.json({ asset: updated });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// DELETE /v1/media/catalog/:id/tags - Remove tags
router.delete('/catalog/:id/tags', async (req: Request, res: Response) => {
    try {
        const { assetCatalog } = await import('../../../services/assetCatalog');
        const { tags } = req.body;
        const updated = assetCatalog.removeTags(req.params.id, tags || []);
        if (!updated) return res.status(404).json({ error: 'Asset not found' });
        return res.json({ asset: updated });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// PUT /v1/media/catalog/:id/folder - Move to folder
router.put('/catalog/:id/folder', async (req: Request, res: Response) => {
    try {
        const { assetCatalog } = await import('../../../services/assetCatalog');
        const { folder } = req.body;
        const updated = assetCatalog.moveToFolder(req.params.id, folder || '/');
        if (!updated) return res.status(404).json({ error: 'Asset not found' });
        return res.json({ asset: updated });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/media/catalog-folders - Get all folders
router.get('/catalog-folders', async (_req: Request, res: Response) => {
    try {
        const { assetCatalog } = await import('../../../services/assetCatalog');
        const folders = assetCatalog.getFolders();
        return res.json({ folders });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/media/catalog-tags - Get all tags
router.get('/catalog-tags', async (_req: Request, res: Response) => {
    try {
        const { assetCatalog } = await import('../../../services/assetCatalog');
        const tags = assetCatalog.getAllTags();
        return res.json({ tags });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/media/catalog-sync - Sync existing files
router.post('/catalog-sync', async (_req: Request, res: Response) => {
    try {
        const { assetCatalog } = await import('../../../services/assetCatalog');

        // Clean up orphans first
        const orphansRemoved = await assetCatalog.cleanupOrphans();

        // Sync existing files
        const { added, skipped } = await assetCatalog.syncExistingFiles();

        return res.json({
            success: true,
            added,
            skipped,
            orphansRemoved
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// ==================== NEXUS CANVAS ====================

// GET /v1/media/canvas/documents - List all canvas documents
router.get('/canvas/documents', async (_req: Request, res: Response) => {
    try {
        const { canvasService } = await import('../../../services/media/canvasService');
        const documents = await canvasService.listDocuments();
        return res.json({ documents });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// GET /v1/media/canvas/documents/:id - Load a canvas document
router.get('/canvas/documents/:id', async (req: Request, res: Response) => {
    try {
        const { canvasService } = await import('../../../services/media/canvasService');
        const document = await canvasService.loadDocument(req.params.id);
        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }
        return res.json({ document: JSON.parse(document) });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/media/canvas/documents - Save a new or existing canvas document
router.post('/canvas/documents', async (req: Request, res: Response) => {
    try {
        const { canvasService } = await import('../../../services/media/canvasService');
        const { id, name, documentJson, thumbnail } = req.body;

        if (!name || !documentJson) {
            return res.status(400).json({ error: 'Missing name or documentJson' });
        }

        const meta = await canvasService.saveDocument({
            id,
            name,
            documentJson,
            thumbnail
        });

        return res.json({ success: true, document: meta });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// DELETE /v1/media/canvas/documents/:id - Delete a canvas document
router.delete('/canvas/documents/:id', async (req: Request, res: Response) => {
    try {
        const { canvasService } = await import('../../../services/media/canvasService');
        const success = await canvasService.deleteDocument(req.params.id);
        if (!success) {
            return res.status(404).json({ error: 'Document not found' });
        }
        return res.json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/media/canvas/inpaint - Generative Fill (AI Inpainting)
router.post('/canvas/inpaint', async (req: Request, res: Response) => {
    try {
        const { canvasService } = await import('../../../services/media/canvasService');
        const { imageBase64, maskBase64, prompt, negativePrompt, preferLocal } = req.body;

        if (!imageBase64 || !maskBase64 || !prompt) {
            return res.status(400).json({ error: 'Missing imageBase64, maskBase64, or prompt' });
        }

        const result = await canvasService.inpaint({
            imageBase64,
            maskBase64,
            prompt,
            negativePrompt,
            preferLocal
        });

        if (!result) {
            return res.status(500).json({ error: 'Inpainting failed' });
        }

        return res.json({ success: true, ...result });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// POST /v1/media/canvas/export - Export canvas to Asset Catalog
router.post('/canvas/export', async (req: Request, res: Response) => {
    try {
        const { canvasService } = await import('../../../services/media/canvasService');
        const { imageBase64, name, prompt, tags, folder } = req.body;

        if (!imageBase64 || !name) {
            return res.status(400).json({ error: 'Missing imageBase64 or name' });
        }

        const assetId = await canvasService.exportToAssetCatalog(
            imageBase64,
            name,
            { prompt, tags, folder }
        );

        return res.json({ success: true, assetId });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;

