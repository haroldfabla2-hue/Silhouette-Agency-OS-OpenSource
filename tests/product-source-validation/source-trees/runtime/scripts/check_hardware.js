
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
            console.log(`- GPU: ${c.model} VRAM: ${c.vram}`);
        });

    } catch (e) {
        console.error("Error reading hardware:", e);
    }
}

check();
