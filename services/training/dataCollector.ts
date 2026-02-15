
import * as fs from 'fs';
import * as path from 'path';
import { SystemProtocol } from '../../types';
import { systemBus } from '../systemBus';

export interface TrainingExample {
    id: string;
    timestamp: number;
    input: string;
    output: string;
    score: number; // 0-1, 1 is perfect
    tags: string[];
    source: string;
}

const DATA_DIR = path.join(process.cwd(), 'data', 'training');
const DATA_FILE = path.join(DATA_DIR, 'dataset.jsonl');

class DataCollectorService {
    private buffer: TrainingExample[] = [];
    private flushThreshold = 1; // [ROBUST] Persist immediately to avoid data loss on crash

    constructor() {
        this.init();
    }

    private init() {
        // Ensure directory exists
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        // Subscribe to High Value Events
        systemBus.subscribe(SystemProtocol.TRAINING_EXAMPLE_FOUND, (event) => {
            const { input, output, score, tags, source } = event.payload;
            this.collect(input, output, score, tags, source);
        });

        console.log("[DATA_COLLECTOR] 🧠 Hippocampus initialized. Ready to form memories.");
    }

    public collect(input: string, output: string, score: number, tags: string[], source: string = 'User') {
        const example: TrainingExample = {
            id: `train_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            input,
            output,
            score,
            tags,
            source
        };

        this.buffer.push(example);
        console.log(`[DATA_COLLECTOR] 📥 Buffer: ${this.buffer.length}/${this.flushThreshold} (New: ${input.substring(0, 30)}...)`);

        if (this.buffer.length >= this.flushThreshold) {
            this.saveToDisk();
        }
    }

    public saveToDisk() {
        if (this.buffer.length === 0) return;

        const lines = this.buffer.map(ex => JSON.stringify(ex)).join('\n');

        try {
            fs.appendFileSync(DATA_FILE, lines + '\n', 'utf8');
            console.log(`[DATA_COLLECTOR] 💾 Flushed ${this.buffer.length} examples to disk.`);
            this.buffer = []; // Clear buffer
        } catch (err) {
            console.error("[DATA_COLLECTOR] ❌ Failed to save training data:", err);
        }
    }

    public getDatasetPath(): string {
        return DATA_FILE;
    }

    public getStats() {
        // Count lines in file for total
        let total = 0;
        try {
            if (fs.existsSync(DATA_FILE)) {
                // Approximate count or read file. Reading whole file might be heavy if huge.
                // For now, let's just return buffer size + file size check (maybe later implement line counting)
                // A fast way is to read the file line by line, but for simple stats, file size might be enough proxy.
                // Let's do a synchronous read for now since dataset isn't massive yet.
                const content = fs.readFileSync(DATA_FILE, 'utf-8');
                total = content.split('\n').filter(line => line.trim().length > 0).length;
            }
        } catch (e) {
            console.warn("[DATA_COLLECTOR] Failed to count dataset lines");
        }

        return {
            bufferCount: this.buffer.length,
            totalSaved: total,
            lastFlush: Date.now() // Approximation if we don't track it
        };
    }

    public getRecentExamples(limit: number = 5): TrainingExample[] {
        // Return buffer + last N from file
        const recent = [...this.buffer].reverse();

        if (recent.length < limit) {
            try {
                if (fs.existsSync(DATA_FILE)) {
                    const lines = fs.readFileSync(DATA_FILE, 'utf-8').trim().split('\n');
                    const fromDisk = lines.slice(-(limit - recent.length)).map(l => JSON.parse(l));
                    return [...recent, ...fromDisk.reverse()];
                }
            } catch (e) {
                // ignore
            }
        }

        return recent.slice(0, limit);
    }
}

export const dataCollector = new DataCollectorService();
