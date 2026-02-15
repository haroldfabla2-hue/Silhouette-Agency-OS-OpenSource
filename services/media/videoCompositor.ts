/**
 * VIDEO COMPOSITOR SERVICE
 * 
 * FFmpeg-based video composition engine for:
 * - Scene concatenation with transitions (xfade)
 * - Audio mixing and synchronization
 * - Long-form video assembly from clips
 * 
 * Supports transitions: fade, dissolve, wipe, radial, circleclose, slideup, etc.
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

// Configure FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath.path);

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type TransitionType =
    | 'fade'
    | 'fadeblack'
    | 'fadewhite'
    | 'dissolve'
    | 'wipeleft'
    | 'wiperight'
    | 'wipeup'
    | 'wipedown'
    | 'slideleft'
    | 'slideright'
    | 'slideup'
    | 'slidedown'
    | 'circlecrop'
    | 'circleclose'
    | 'circleopen'
    | 'radial'
    | 'smoothleft'
    | 'smoothright'
    | 'none';

export interface ClipReference {
    clipId: string;
    filePath: string;
    startTime?: number;   // Trim start (seconds)
    endTime?: number;     // Trim end (seconds)
    volume?: number;      // 0-1
}

export interface TransitionSpec {
    type: TransitionType;
    duration: number;     // seconds (typically 0.5-2)
    fromClipIndex: number;
    toClipIndex: number;
}

export interface AudioTrack {
    trackId: string;
    type: 'voiceover' | 'music' | 'sfx';
    filePath: string;
    startTime: number;    // When to start in final video
    volume: number;       // 0-1
    fadeIn?: number;      // Fade in duration (seconds)
    fadeOut?: number;     // Fade out duration (seconds)
    loop?: boolean;       // Loop for background music
}

export interface CompositorJob {
    jobId: string;
    projectId?: string;
    clips: ClipReference[];
    audioTracks: AudioTrack[];
    transitions: TransitionSpec[];
    outputPath: string;
    outputFormat: 'mp4' | 'webm' | 'mov';
    targetCodec: 'h264' | 'h265' | 'vp9' | 'prores';
    targetResolution: string;  // e.g. "1920x1080"
    targetFps: number;
    qualityPreset: 'ultrafast' | 'fast' | 'medium' | 'slow' | 'veryslow';
}

export interface CompositorProgress {
    jobId: string;
    phase: 'VALIDATING' | 'TRANSCODING' | 'COMPOSING' | 'AUDIO_MIX' | 'EXPORTING' | 'COMPLETE' | 'FAILED';
    percent: number;
    currentFrame?: number;
    totalFrames?: number;
    fps?: number;
    eta?: string;
}

export interface CompositorResult {
    success: boolean;
    outputPath?: string;
    duration?: number;
    fileSize?: number;
    error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// VIDEO COMPOSITOR CLASS
// ═══════════════════════════════════════════════════════════════════════════

class VideoCompositor {
    private outputDir: string;
    private tempDir: string;

    constructor() {
        this.outputDir = path.resolve(process.cwd(), 'data/output/videos');
        this.tempDir = path.resolve(process.cwd(), 'data/temp/compositor');
        this.ensureDirectories();
        console.log('[VideoCompositor] 🎬 Service Initialized');
    }

    private async ensureDirectories() {
        await fs.mkdir(this.outputDir, { recursive: true });
        await fs.mkdir(this.tempDir, { recursive: true });
    }

    /**
     * Compose multiple clips with transitions into a final video
     */
    public async compose(job: CompositorJob): Promise<CompositorResult> {
        console.log(`[VideoCompositor] 🎬 Starting Composition Job: ${job.jobId}`);
        console.log(`[VideoCompositor] 📊 Clips: ${job.clips.length}, Transitions: ${job.transitions.length}, Audio: ${job.audioTracks.length}`);

        this.emitProgress(job.jobId, 'VALIDATING', 0);

        try {
            // 1. Validate all input files exist
            await this.validateInputs(job);
            this.emitProgress(job.jobId, 'VALIDATING', 10);

            // 2. Get clip durations
            const clipDurations = await this.getClipDurations(job.clips);
            console.log(`[VideoCompositor] ⏱️ Clip durations:`, clipDurations);

            // 3. Build the filter complex for transitions
            if (job.clips.length === 1) {
                // Single clip - just copy
                return await this.processSingleClip(job);
            }

            this.emitProgress(job.jobId, 'COMPOSING', 20);

            // 4. Generate FFmpeg command with xfade transitions
            const ffmpegCommand = this.buildTransitionCommand(job, clipDurations);
            console.log(`[VideoCompositor] 🔧 FFmpeg Command Built`);

            // 5. Execute FFmpeg
            this.emitProgress(job.jobId, 'EXPORTING', 40);
            await this.executeFFmpeg(ffmpegCommand, job);

            // 6. Get output file info
            const stats = await fs.stat(job.outputPath);
            const duration = await this.getVideoDuration(job.outputPath);

            this.emitProgress(job.jobId, 'COMPLETE', 100);

            console.log(`[VideoCompositor] ✅ Composition Complete: ${job.outputPath}`);
            console.log(`[VideoCompositor] 📁 File Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

            systemBus.emit(SystemProtocol.WORK_COMPLETE, {
                type: 'VIDEO_COMPOSITION',
                jobId: job.jobId,
                outputPath: job.outputPath,
                duration
            });

            return {
                success: true,
                outputPath: job.outputPath,
                duration,
                fileSize: stats.size
            };

        } catch (error: any) {
            console.error(`[VideoCompositor] ❌ Composition Failed:`, error);
            this.emitProgress(job.jobId, 'FAILED', 0);

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Build FFmpeg command with xfade filter complex for transitions
     */
    private buildTransitionCommand(job: CompositorJob, durations: number[]): string[] {
        const inputs: string[] = [];
        const filterParts: string[] = [];

        // Add all input files
        job.clips.forEach((clip, i) => {
            inputs.push('-i', clip.filePath);
        });

        // Build xfade chain
        let currentOutput = '[0:v]';
        let currentAudioOutput = '[0:a]';
        let offset = durations[0];

        for (let i = 1; i < job.clips.length; i++) {
            const transition = job.transitions.find(t => t.fromClipIndex === i - 1 && t.toClipIndex === i);
            const transType = transition?.type || 'fade';
            const transDuration = transition?.duration || 0.5;

            // Video transition
            const videoOut = i === job.clips.length - 1 ? '[vout]' : `[v${i}]`;
            offset -= transDuration; // Overlap for transition

            filterParts.push(
                `${currentOutput}[${i}:v]xfade=transition=${transType}:duration=${transDuration}:offset=${offset.toFixed(2)}${videoOut}`
            );

            // Audio crossfade
            const audioOut = i === job.clips.length - 1 ? '[aout]' : `[a${i}]`;
            filterParts.push(
                `${currentAudioOutput}[${i}:a]acrossfade=d=${transDuration}${audioOut}`
            );

            currentOutput = videoOut;
            currentAudioOutput = audioOut;
            offset += durations[i];
        }

        const filterComplex = filterParts.join(';');

        // Build full command
        const command = [
            ...inputs,
            '-filter_complex', filterComplex,
            '-map', '[vout]',
            '-map', '[aout]',
            '-c:v', this.getVideoCodec(job.targetCodec),
            '-preset', job.qualityPreset,
            '-c:a', 'aac',
            '-b:a', '192k',
            '-y',
            job.outputPath
        ];

        return command;
    }

    /**
     * Get video codec for FFmpeg
     */
    private getVideoCodec(codec: string): string {
        const codecMap: Record<string, string> = {
            'h264': 'libx264',
            'h265': 'libx265',
            'vp9': 'libvpx-vp9',
            'prores': 'prores_ks'
        };
        return codecMap[codec] || 'libx264';
    }

    /**
     * Execute FFmpeg command with progress tracking
     */
    private executeFFmpeg(args: string[], job: CompositorJob): Promise<void> {
        return new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const ffmpegProcess = spawn(ffmpegPath.path, args);

            let stderr = '';

            ffmpegProcess.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();

                // Parse progress from FFmpeg output
                const frameMatch = stderr.match(/frame=\s*(\d+)/);
                const fpsMatch = stderr.match(/fps=\s*(\d+)/);

                if (frameMatch) {
                    const frame = parseInt(frameMatch[1]);
                    // Estimate progress (rough)
                    const estimatedTotal = job.clips.length * 150; // ~5 seconds per clip at 30fps
                    const percent = Math.min(95, Math.round((frame / estimatedTotal) * 100));
                    this.emitProgress(job.jobId, 'EXPORTING', 40 + percent * 0.6);
                }
            });

            ffmpegProcess.on('close', (code: number) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
                }
            });

            ffmpegProcess.on('error', (err: Error) => {
                reject(err);
            });
        });
    }

    /**
     * Process single clip (no transitions needed)
     */
    private async processSingleClip(job: CompositorJob): Promise<CompositorResult> {
        return new Promise((resolve, reject) => {
            ffmpeg(job.clips[0].filePath)
                .videoCodec(this.getVideoCodec(job.targetCodec))
                .audioCodec('aac')
                .audioBitrate('192k')
                .outputOptions([`-preset ${job.qualityPreset}`])
                .save(job.outputPath)
                .on('end', async () => {
                    const stats = await fs.stat(job.outputPath);
                    const duration = await this.getVideoDuration(job.outputPath);
                    resolve({
                        success: true,
                        outputPath: job.outputPath,
                        duration,
                        fileSize: stats.size
                    });
                })
                .on('error', (err) => {
                    reject(err);
                });
        });
    }

    /**
     * Validate all input files exist
     */
    private async validateInputs(job: CompositorJob): Promise<void> {
        for (const clip of job.clips) {
            try {
                await fs.access(clip.filePath);
            } catch {
                throw new Error(`Clip file not found: ${clip.filePath}`);
            }
        }

        for (const audio of job.audioTracks) {
            try {
                await fs.access(audio.filePath);
            } catch {
                throw new Error(`Audio file not found: ${audio.filePath}`);
            }
        }
    }

    /**
     * Get duration of all clips
     */
    private async getClipDurations(clips: ClipReference[]): Promise<number[]> {
        const durations: number[] = [];

        for (const clip of clips) {
            const duration = await this.getVideoDuration(clip.filePath);
            durations.push(duration);
        }

        return durations;
    }

    /**
     * Get duration of a video file
     */
    private getVideoDuration(filePath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(metadata.format.duration || 0);
            });
        });
    }

    /**
     * Create a simple concat (no transitions)
     */
    public async concatSimple(clips: string[], outputPath: string): Promise<CompositorResult> {
        const listFile = path.join(this.tempDir, `concat_${Date.now()}.txt`);

        // Create concat list file
        const listContent = clips.map(c => `file '${c}'`).join('\n');
        await fs.writeFile(listFile, listContent);

        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(listFile)
                .inputOptions(['-f concat', '-safe 0'])
                .videoCodec('copy')
                .audioCodec('copy')
                .save(outputPath)
                .on('end', async () => {
                    await fs.unlink(listFile).catch(() => { });
                    const stats = await fs.stat(outputPath);
                    const duration = await this.getVideoDuration(outputPath);
                    resolve({
                        success: true,
                        outputPath,
                        duration,
                        fileSize: stats.size
                    });
                })
                .on('error', async (err) => {
                    await fs.unlink(listFile).catch(() => { });
                    reject(err);
                });
        });
    }

    /**
     * Add audio track to video
     */
    public async mixAudio(videoPath: string, audioTracks: AudioTrack[], outputPath: string): Promise<CompositorResult> {
        return new Promise((resolve, reject) => {
            let command = ffmpeg(videoPath);

            // Add audio inputs
            audioTracks.forEach(track => {
                command.input(track.filePath);
            });

            // Build audio filter
            const audioFilters: string[] = [];
            audioTracks.forEach((track, i) => {
                const inputIdx = i + 1;
                let filter = `[${inputIdx}:a]`;

                // Volume adjustment
                filter += `volume=${track.volume}`;

                // Fade in/out
                if (track.fadeIn) {
                    filter += `,afade=t=in:st=0:d=${track.fadeIn}`;
                }
                if (track.fadeOut) {
                    filter += `,afade=t=out:st=${track.startTime}:d=${track.fadeOut}`;
                }

                filter += `[a${i}]`;
                audioFilters.push(filter);
            });

            // Mix all audio tracks
            const mixInputs = audioTracks.map((_, i) => `[a${i}]`).join('');
            audioFilters.push(`[0:a]${mixInputs}amix=inputs=${audioTracks.length + 1}[aout]`);

            command
                .complexFilter(audioFilters.join(';'))
                .outputOptions(['-map 0:v', '-map [aout]'])
                .videoCodec('copy')
                .audioCodec('aac')
                .save(outputPath)
                .on('end', async () => {
                    const stats = await fs.stat(outputPath);
                    const duration = await this.getVideoDuration(outputPath);
                    resolve({
                        success: true,
                        outputPath,
                        duration,
                        fileSize: stats.size
                    });
                })
                .on('error', (err) => {
                    reject(err);
                });
        });
    }

    /**
     * Generate preview (lower resolution)
     */
    public async generatePreview(inputPath: string, outputPath: string, resolution: string = '640x360'): Promise<CompositorResult> {
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .size(resolution)
                .videoCodec('libx264')
                .outputOptions(['-preset ultrafast', '-crf 28'])
                .audioCodec('aac')
                .audioBitrate('64k')
                .save(outputPath)
                .on('end', async () => {
                    const stats = await fs.stat(outputPath);
                    const duration = await this.getVideoDuration(outputPath);
                    resolve({
                        success: true,
                        outputPath,
                        duration,
                        fileSize: stats.size
                    });
                })
                .on('error', (err) => {
                    reject(err);
                });
        });
    }

    /**
     * Create a job with default settings
     */
    public createJob(clips: ClipReference[], outputFilename?: string): CompositorJob {
        const jobId = uuidv4();
        const filename = outputFilename || `composed_${jobId}.mp4`;

        // Auto-generate transitions between all clips
        const transitions: TransitionSpec[] = [];
        for (let i = 0; i < clips.length - 1; i++) {
            transitions.push({
                type: 'dissolve',
                duration: 0.5,
                fromClipIndex: i,
                toClipIndex: i + 1
            });
        }

        return {
            jobId,
            clips,
            transitions,
            audioTracks: [],
            outputPath: path.join(this.outputDir, filename),
            outputFormat: 'mp4',
            targetCodec: 'h264',
            targetResolution: '1920x1080',
            targetFps: 30,
            qualityPreset: 'medium'
        };
    }

    /**
     * Emit progress event
     */
    private emitProgress(jobId: string, phase: CompositorProgress['phase'], percent: number) {
        const progress: CompositorProgress = {
            jobId,
            phase,
            percent
        };

        systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
            type: 'COMPOSITOR_PROGRESS',
            ...progress
        });
    }

    /**
     * Clean up temp files
     */
    public async cleanup(): Promise<void> {
        try {
            const files = await fs.readdir(this.tempDir);
            for (const file of files) {
                await fs.unlink(path.join(this.tempDir, file)).catch(() => { });
            }
            console.log('[VideoCompositor] 🧹 Temp files cleaned');
        } catch (e) {
            console.warn('[VideoCompositor] Could not clean temp dir');
        }
    }
}

// Singleton export
export const videoCompositor = new VideoCompositor();
