import { fileTypeFromBuffer } from 'file-type';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import path from 'path';
import fs from 'fs/promises';

// Configure FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath.path);

/**
 * Validate audio format from buffer
 */
export async function validateAudioFormat(buffer: Buffer): Promise<{
    isValid: boolean;
    detectedFormat: string;
    needsConversion: boolean;
}> {
    const type = await fileTypeFromBuffer(buffer);

    if (!type) {
        return { isValid: false, detectedFormat: 'unknown', needsConversion: false };
    }

    const isWav = type.mime === 'audio/wav' || type.mime === 'audio/x-wav';
    const isWebM = type.mime === 'video/webm' || type.mime === 'audio/webm';
    const isMP3 = type.mime === 'audio/mpeg';
    const isOgg = type.mime === 'audio/ogg';

    return {
        isValid: isWav || isWebM || isMP3 || isOgg,
        detectedFormat: type.mime,
        needsConversion: !isWav || isWebM || isMP3 || isOgg
    };
}

/**
 * Convert any audio format to standard WAV (16kHz, mono, PCM)
 * Required for XTTS v2 voice cloning
 */
export async function convertToStandardWav(
    inputPath: string,
    outputPath: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioCodec('pcm_s16le')  // 16-bit PCM (required by soundfile)
            .audioFrequency(16000)     // 16kHz (XTTS requirement)
            .audioChannels(1)          // Mono (XTTS requirement)
            .format('wav')
            .on('start', (cmd) => {
                console.log('[AUDIO_CONVERTER] FFmpeg command:', cmd);
            })
            .on('end', () => {
                console.log('[AUDIO_CONVERTER] ✅ Conversion complete');
                resolve();
            })
            .on('error', (err) => {
                console.error('[AUDIO_CONVERTER] ❌ Conversion failed:', err);
                reject(err);
            })
            .save(outputPath);
    });
}

/**
 * Validate WAV file specifications
 */
export async function validateWavSpecs(filePath: string): Promise<{
    sampleRate: number;
    channels: number;
    codec: string;
    isValid: boolean;
}> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);

            const audio = metadata.streams.find(s => s.codec_type === 'audio');
            if (!audio) return reject(new Error('No audio stream found'));

            const sampleRate = audio.sample_rate ? parseInt(audio.sample_rate as string) : 0;
            const channels = audio.channels || 0;
            const codec = audio.codec_name || 'unknown';

            // XTTS v2 requirements: 16kHz, mono, PCM
            const isValid = sampleRate === 16000 && channels === 1 && codec === 'pcm_s16le';

            resolve({
                sampleRate,
                channels,
                codec,
                isValid
            });
        });
    });
}

/**
 * Process uploaded audio file for voice cloning
 * Handles format detection, conversion, and validation
 */
export async function processVoiceFile(
    uploadedFilePath: string,
    outputFilePath: string
): Promise<{ success: boolean; error?: string }> {
    try {
        // 1. Read file and detect format
        const buffer = await fs.readFile(uploadedFilePath);
        const validation = await validateAudioFormat(buffer);

        console.log(`[VOICE_PROCESSOR] Detected format: ${validation.detectedFormat}`);

        if (!validation.isValid) {
            return {
                success: false,
                error: `Unsupported audio format: ${validation.detectedFormat}`
            };
        }

        // 2. Convert if needed
        if (validation.needsConversion) {
            console.log(`[VOICE_PROCESSOR] Converting ${validation.detectedFormat} → WAV (16kHz, mono)`);
            await convertToStandardWav(uploadedFilePath, outputFilePath);
        } else {
            // Already WAV, but validate specs
            const specs = await validateWavSpecs(uploadedFilePath);
            console.log(`[VOICE_PROCESSOR] WAV specs:`, specs);

            if (!specs.isValid) {
                console.log(`[VOICE_PROCESSOR] Re-encoding to standard specs`);
                await convertToStandardWav(uploadedFilePath, outputFilePath);
            } else {
                // Perfect WAV, just copy
                await fs.copyFile(uploadedFilePath, outputFilePath);
            }
        }

        // 3. Final validation
        const finalSpecs = await validateWavSpecs(outputFilePath);
        if (!finalSpecs.isValid) {
            return {
                success: false,
                error: `Failed to produce valid WAV: ${JSON.stringify(finalSpecs)}`
            };
        }

        console.log(`[VOICE_PROCESSOR] ✅ Voice file ready: ${outputFilePath}`);
        return { success: true };

    } catch (error) {
        console.error('[VOICE_PROCESSOR] ❌ Processing failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}
