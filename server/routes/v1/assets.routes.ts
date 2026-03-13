import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// Configure multer for asset uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'uploads', 'assets');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage });

// POST /v1/assets/upload
router.post('/upload', upload.single('file'), async (req: any, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // 1. Move file to permanent storage
        const STORAGE_DIR = path.join(process.cwd(), 'uploads', 'assets_permanent');
        if (!fs.existsSync(STORAGE_DIR)) {
            fs.mkdirSync(STORAGE_DIR, { recursive: true });
        }
        const destPath = path.join(STORAGE_DIR, req.file.filename);
        await fs.promises.rename(req.file.path, destPath); // Use fs.promises for async operations

        // Return the format expected by ChatWidget.tsx
        res.json({
            success: true,
            filename: req.file.originalname,
            path: `/permanent_uploads/assets/${req.file.filename}` // Update path to permanent storage
        });
    } catch (error: any) {
        console.error('[ASSETS] File upload failed:', error.message);
        res.status(500).json({ error: 'Failed to upload asset' });
    }
});

export default router;
