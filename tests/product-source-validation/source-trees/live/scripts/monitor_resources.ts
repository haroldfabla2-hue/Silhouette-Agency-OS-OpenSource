
import os from 'os';

console.log("📊 System Resource Monitor");
console.log("------------------------");

const used = process.memoryUsage();
console.log(`Node.js Process Memory:`);
console.log(`- RSS: ${Math.round(used.rss / 1024 / 1024 * 100) / 100} MB`);
console.log(`- Heap Total: ${Math.round(used.heapTotal / 1024 / 1024 * 100) / 100} MB`);
console.log(`- Heap Used: ${Math.round(used.heapUsed / 1024 / 1024 * 100) / 100} MB`);
console.log(`- External: ${Math.round(used.external / 1024 / 1024 * 100) / 100} MB`);

console.log("\nSystem Memory:");
const totalMem = os.totalmem();
const freeMem = os.freemem();
console.log(`- Total: ${Math.round(totalMem / 1024 / 1024 / 1024 * 100) / 100} GB`);
console.log(`- Free: ${Math.round(freeMem / 1024 / 1024 / 1024 * 100) / 100} GB`);
console.log(`- Used: ${Math.round((totalMem - freeMem) / 1024 / 1024 / 1024 * 100) / 100} GB`);

console.log("\nCPU Load:");
const cpus = os.cpus();
console.log(`- Cores: ${cpus.length}`);
console.log(`- Model: ${cpus[0].model}`);
