import { contextResolver } from './services/contextResolver';
import { visualCortex } from './services/visualCortex';

async function verify() {
    console.log("Verifying Universal Asset Pipeline...");

    // 1. Resolve Context
    const context = contextResolver.resolveFromProject('REACT_VITE', 'TestProject');
    console.log("Context Resolved:", context.identity);

    // 2. Trigger Visual Cortex
    const asset = await visualCortex.initiateHybridFlow({
        id: 'test_req',
        prompt: 'Futuristic City',
        brandId: 'test',
        aspectRatio: '16:9',
        outputType: 'IMAGE'
    }, context);

    console.log("Asset Generated:", asset);
}

verify().catch(console.error);
