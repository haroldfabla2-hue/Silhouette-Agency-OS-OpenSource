import si from 'systeminformation';

console.log("Monitoring CPU Load (Press Ctrl+C to stop)...");

setInterval(async () => {
    try {
        const load = await si.currentLoad();
        console.log("--------------------------------");
        console.log(`Total Load: ${load.currentLoad.toFixed(2)}%`);
        console.log(`User Load:  ${load.currentLoadUser.toFixed(2)}%`);
        console.log(`Sys Load:   ${load.currentLoadSystem.toFixed(2)}%`);
        console.log(`Idle:       ${load.currentLoadIdle.toFixed(2)}%`);
        console.log(`Raw:        `, load);
    } catch (e) {
        console.error(e);
    }
}, 2000);
