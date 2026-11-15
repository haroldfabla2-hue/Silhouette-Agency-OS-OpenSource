import { minimaxService } from '../../services/minimaxService';
import fs from 'fs';
import path from 'path';

async function main() {
    console.log('[DEBUG] Testing Minimax TTS Integration...');
    try {
        const text = "Hola. Esta es una prueba del sistema de audio Minimax, funcionando de forma nativa en Silhouette OS sin utilizar el motor de Python.";
        console.log(`[DEBUG] Text: "${text}"`);

        const url = await minimaxService.generateSpeech(text);

        if (url) {
            console.log(`[DEBUG] ✅ SUCCESS! Audio saved to: ${url}`);
            const fullPath = path.join(process.cwd(), url);
            const stats = fs.statSync(fullPath);
            console.log(`[DEBUG] File size: ${(stats.size / 1024).toFixed(2)} KB`);
        } else {
            console.error('[DEBUG] ❌ FAILED. Response was null.');
        }
    } catch (e: any) {
        console.error('[DEBUG] ❌ Exception caught:', e.message);
    }
}

main();
