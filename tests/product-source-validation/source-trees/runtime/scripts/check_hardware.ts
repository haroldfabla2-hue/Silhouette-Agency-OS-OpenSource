
import si from 'systeminformation';

async function check() {
    console.log("Checking Hardware...");
    try {
        const cpu = await si.currentLoad();
        console.log("CPU Load:", cpu.currentLoad);

        const mem = await si.mem();
        console.log("RAM Active:", mem.active);
        console.log("RAM Total:", mem.total);

        const graphics = await si.graphics();
        console.log("Graphics Controllers:", graphics.controllers.length);
        graphics.controllers.forEach(c => {
            const vendor = detectVendor(c.vendor || '', c.model || '');
            console.log(`- GPU: ${c.model} | Vendor: ${vendor} | VRAM: ${c.vram} MB`);
        });

        // Summary recommendation
        const primaryGpu = graphics.controllers[0];
        if (primaryGpu) {
            const vendor = detectVendor(primaryGpu.vendor || '', primaryGpu.model || '');
            console.log(`\nRecommended setup:`);
            if (vendor === 'nvidia') {
                console.log(`  PyTorch backend: CUDA`);
                console.log(`  Install: pip install torch --index-url https://download.pytorch.org/whl/cu121`);
            } else if (vendor === 'amd') {
                console.log(`  PyTorch backend: ROCm`);
                console.log(`  Install: pip install torch --index-url https://download.pytorch.org/whl/rocm6.1`);
            } else {
                console.log(`  PyTorch backend: CPU`);
                console.log(`  Install: pip install torch --index-url https://download.pytorch.org/whl/cpu`);
            }
            console.log(`  Full setup: python scripts/setup_torch.py`);
        }

    } catch (e) {
        console.error("Error reading hardware:", e);
    }
}

function detectVendor(vendor: string, model: string): string {
    const combined = `${vendor} ${model}`.toLowerCase();
    if (combined.includes('nvidia') || combined.includes('geforce') || combined.includes('quadro') || combined.includes('rtx') || combined.includes('gtx')) {
        return 'nvidia';
    }
    if (combined.includes('amd') || combined.includes('radeon') || combined.includes('advanced micro')) {
        return 'amd';
    }
    if (combined.includes('intel')) {
        return 'intel';
    }
    if (combined.includes('apple')) {
        return 'apple';
    }
    return 'unknown';
}

check();
