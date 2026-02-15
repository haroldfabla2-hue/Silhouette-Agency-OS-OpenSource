const si = require('systeminformation');

async function testCpu() {
    console.log('Testing systeminformation.currentLoad()...');
    try {
        const load1 = await si.currentLoad();
        console.log('Load 1:', load1);

        console.log('Waiting 2 seconds...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        const load2 = await si.currentLoad();
        console.log('Load 2:', load2);
    } catch (e) {
        console.error('Error:', e);
    }
}

testCpu();
