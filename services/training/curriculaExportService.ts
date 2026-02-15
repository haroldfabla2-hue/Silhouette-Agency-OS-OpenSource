/**
 * CURRICULA EXPORT SERVICE
 * ========================
 * Converts collected training examples into curricula format for NanoSilhouette.
 * 
 * This service REPLACES the previous in-process training (LoRA/adapter training)
 * with a lightweight export mechanism. The actual training is completely
 * delegated to NanoSilhouette, which has its own training infrastructure.
 * 
 * Benefits:
 * - No GPU/VRAM usage in Silhouette Agency OS for training
 * - Decoupled architecture: Agency collects data, NanoSilhouette trains
 * - Simpler resource management
 * - NanoSilhouette can train offline/on different hardware
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

export interface CurriculumEntry {
    input: string;
    output: string;
    tags?: string[];
    score?: number;
    source?: string;
    timestamp?: number;
}

export interface CurriculumExportResult {
    success: boolean;
    path: string;
    entriesExported: number;
    format: 'jsonl' | 'json';
    timestamp: number;
    error?: string;
}

class CurriculaExportService {
    private readonly SILHOUETTE_DATA_DIR = path.join(process.cwd(), 'silhouette', 'data');
    private readonly CURRICULUM_FILENAME = 'curriculum.jsonl';
    private readonly TRAINING_DATASET_PATH = path.join(process.cwd(), 'data', 'training', 'dataset.jsonl');

    /**
     * Export collected training data to NanoSilhouette's expected format.
     * This is the main method called by DreamerService instead of spawning training.
     */
    public async exportCurricula(): Promise<CurriculumExportResult> {
        console.log('[CURRICULA_EXPORT] 📚 Starting curricula export for NanoSilhouette...');

        try {
            // 1. Ensure output directory exists
            await this.ensureDirectoryExists(this.SILHOUETTE_DATA_DIR);

            // 2. Read collected training examples
            const examples = await this.readTrainingDataset();

            if (examples.length === 0) {
                console.log('[CURRICULA_EXPORT] ⚠️ No training examples found. Skipping export.');
                return {
                    success: true,
                    path: '',
                    entriesExported: 0,
                    format: 'jsonl',
                    timestamp: Date.now()
                };
            }

            // 3. Transform to NanoSilhouette format
            const curriculum = this.transformToCurriculum(examples);

            // 4. Write to NanoSilhouette data directory
            const outputPath = path.join(this.SILHOUETTE_DATA_DIR, this.CURRICULUM_FILENAME);
            await this.writeCurriculum(outputPath, curriculum);

            console.log(`[CURRICULA_EXPORT] ✅ Exported ${curriculum.length} entries to ${outputPath}`);

            // 5. Emit success event
            const result: CurriculumExportResult = {
                success: true,
                path: outputPath,
                entriesExported: curriculum.length,
                format: 'jsonl',
                timestamp: Date.now()
            };

            systemBus.emit(SystemProtocol.CURRICULA_READY, result, 'CURRICULA_EXPORT_SERVICE');

            return result;

        } catch (error: any) {
            console.error('[CURRICULA_EXPORT] ❌ Export failed:', error.message);

            return {
                success: false,
                path: '',
                entriesExported: 0,
                format: 'jsonl',
                timestamp: Date.now(),
                error: error.message
            };
        }
    }

    /**
     * Read the collected training dataset (from dataCollector).
     */
    private async readTrainingDataset(): Promise<CurriculumEntry[]> {
        try {
            const content = await fs.readFile(this.TRAINING_DATASET_PATH, 'utf-8');
            const lines = content.trim().split('\n').filter(line => line.trim());

            const entries: CurriculumEntry[] = [];
            for (const line of lines) {
                try {
                    const parsed = JSON.parse(line);
                    entries.push({
                        input: parsed.input || '',
                        output: parsed.output || '',
                        tags: parsed.tags || [],
                        score: parsed.score || 1.0,
                        source: parsed.source || 'unknown',
                        timestamp: parsed.timestamp || Date.now()
                    });
                } catch {
                    // Skip malformed lines
                    continue;
                }
            }

            console.log(`[CURRICULA_EXPORT] 📖 Read ${entries.length} entries from dataset`);
            return entries;

        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.log('[CURRICULA_EXPORT] 📭 No existing dataset file found');
                return [];
            }
            throw error;
        }
    }

    /**
     * Transform training examples to NanoSilhouette's expected curriculum format.
     * NanoSilhouette expects simple {input, output} pairs in JSONL.
     */
    private transformToCurriculum(examples: CurriculumEntry[]): CurriculumEntry[] {
        // Filter out low-quality examples (score < 0.5)
        const qualityFiltered = examples.filter(e => (e.score || 1.0) >= 0.5);

        // Sort by timestamp (newest first for recency bias)
        qualityFiltered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        // Limit to prevent overwhelming NanoSilhouette (configurable)
        const MAX_ENTRIES = 10000;
        const limited = qualityFiltered.slice(0, MAX_ENTRIES);

        console.log(`[CURRICULA_EXPORT] 🔍 Filtered ${examples.length} → ${limited.length} quality entries`);

        return limited;
    }

    /**
     * Write curriculum to JSONL file.
     */
    private async writeCurriculum(outputPath: string, curriculum: CurriculumEntry[]): Promise<void> {
        const content = curriculum
            .map(entry => JSON.stringify({
                input: entry.input,
                output: entry.output,
                // Include metadata for NanoSilhouette's advanced training
                tags: entry.tags,
                score: entry.score,
                source: entry.source
            }))
            .join('\n');

        await fs.writeFile(outputPath, content, 'utf-8');
    }

    /**
     * Ensure directory exists, create if not.
     */
    private async ensureDirectoryExists(dirPath: string): Promise<void> {
        try {
            await fs.access(dirPath);
        } catch {
            await fs.mkdir(dirPath, { recursive: true });
            console.log(`[CURRICULA_EXPORT] 📁 Created directory: ${dirPath}`);
        }
    }

    /**
     * Get curriculum export status.
     */
    public async getExportStatus(): Promise<{
        lastExportPath: string | null;
        lastExportTime: number | null;
        currentDatasetSize: number;
    }> {
        const outputPath = path.join(this.SILHOUETTE_DATA_DIR, this.CURRICULUM_FILENAME);

        let lastExportTime: number | null = null;
        try {
            const stats = await fs.stat(outputPath);
            lastExportTime = stats.mtimeMs;
        } catch {
            // File doesn't exist
        }

        let currentDatasetSize = 0;
        try {
            const content = await fs.readFile(this.TRAINING_DATASET_PATH, 'utf-8');
            currentDatasetSize = content.trim().split('\n').filter(l => l.trim()).length;
        } catch {
            // Dataset doesn't exist
        }

        return {
            lastExportPath: lastExportTime ? outputPath : null,
            lastExportTime,
            currentDatasetSize
        };
    }
}

export const curriculaExportService = new CurriculaExportService();
