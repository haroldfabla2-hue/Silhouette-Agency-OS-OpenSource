/**
 * Voice File Repair Script
 * Converts all existing voice files to standard WAV format (16kHz, mono, PCM)
 * Run with: npx tsx scripts/repair_voice_files.ts
 */

import { convertToStandardWav, validateWavSpecs } from '../utils/audioConverter';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function repairVoiceFiles() {
    console.log('🔧 Voice File Repair Script');
    console.log('================================\n');

    const baseDir = path.join(__dirname, '../uploads/voice');
    const directories = ['cloned', 'library', 'voices'];

    let totalFiles = 0;
    let repairedFiles = 0;
    let failedFiles = 0;

    for (const dir of directories) {
        const dirPath = path.join(baseDir, dir);

        try {
            const files = await fs.readdir(dirPath);
            const wavFiles = files.filter(f => f.endsWith('.wav'));

            if (wavFiles.length === 0) {
                console.log(`📁 ${dir}/: No WAV files found\n`);
                continue;
            }

            console.log(`📁 ${dir}/: Found ${wavFiles.length} file(s)`);

            for (const file of wavFiles) {
                totalFiles++;
                const filePath = path.join(dirPath, file);
                const tempPath = filePath + '.temp.wav';
                const backupPath = filePath + '.backup';

                try {
                    console.log(`   Checking ${file}...`);

                    // Backup original
                    await fs.copyFile(filePath, backupPath);

                    // Convert to standard format
                    console.log(`   🔄 Converting to standard WAV (16kHz, mono, PCM)...`);
                    await convertToStandardWav(filePath, tempPath);

                    // Replace original with converted
                    await fs.unlink(filePath);
                    await fs.rename(tempPath, filePath);

                    console.log(`   ✅ Repaired successfully`);
                    await fs.unlink(backupPath); // Remove backup
                    repairedFiles++;

                } catch (error) {
                    console.error(`   ❌ Failed: ${error instanceof Error ? error.message : error}`);
                    failedFiles++;

                    // Restore from backup if exists
                    try {
                        const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
                        if (backupExists) {
                            await fs.copyFile(backupPath, filePath);
                            await fs.unlink(backupPath);
                            console.log(`   🔄 Restored from backup`);
                        }
                    } catch { }

                    // Clean up temp file
                    try {
                        await fs.unlink(tempPath);
                    } catch { }
                }

                console.log('');
            }

        } catch (error) {
            console.error(`❌ Error processing ${dir}/:`, error);
        }
    }

    console.log('================================');
    console.log('📊 Summary:');
    console.log(`   Total files: ${totalFiles}`);
    console.log(`   Repaired: ${repairedFiles}`);
    console.log(`   Failed: ${failedFiles}`);
    console.log(`   Already valid: ${totalFiles - repairedFiles - failedFiles}`);
    console.log('================================\n');

    if (failedFiles > 0) {
        console.log('⚠️  Some files could not be repaired. Check logs above.');
        process.exit(1);
    } else {
        console.log('✅ All voice files are now in standard format!');
        process.exit(0);
    }
}

// Run the repair
repairVoiceFiles().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
