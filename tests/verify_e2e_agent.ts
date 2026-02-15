
import * as dotenv from 'dotenv';
import path from 'path';

// 1. Load Environment Variables FIRST
// explicit path to ensure we hit the root .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config(); // Fallback to .env

import { AgentCapability, IntrospectionLayer, AgentRoleType, WorkflowStage } from '../types';

async function testE2EAgent() {
    console.log("🎬 Starting E2E Agent Test: Video Generation");

    // 2. Dynamic Import of Services (After Env Load)
    // This prevents 'constants.ts' or 'geminiService.ts' from initializing 
    // with undefined process.env variables.
    const { generateAgentResponse } = await import('../services/geminiService');

    const prompt = "COMMAND: Use the generate_video tool immediately. Do not explain. Just generate a vertical video of a neon cyber city using the WAN engine.";

    console.log(`[USER]: ${prompt}`);

    // Check if key loaded
    const key = process.env.VITE_API_KEY || process.env.GOOGLE_API_KEY;
    if (!key) {
        console.error("❌ CRITICAL: No API Key found in process.env even after loading .env.local");
        console.log("Loaded keys:", Object.keys(process.env).filter(k => k.includes('KEY') || k.includes('TOKEN')));
        return;
    } else {
        console.log(`✅ Environment loaded. Key found: ${key.substring(0, 8)}...`);
    }

    try {
        const response = await generateAgentResponse(
            "TestAgent",
            "Creative Director",
            "CREATIVE",
            prompt,
            null,
            IntrospectionLayer.OPTIMAL,
            WorkflowStage.EXECUTION,
            {}, // Project Context
            {}, // Sensory Data
            [AgentCapability.TOOL_VIDEO_GENERATION], // CAPABILITIES!
            undefined
        );

        console.log("\n--- AGENT RESPONSE ---");
        console.log(response.output);
        console.log("----------------------\n");

        if (response.output.includes("Video generation job queued") || response.output.includes("generate_video")) {
            console.log("✅ SUCCESS: Agent queued the video generation.");
        } else {
            // It might fail if the model decides not to call the tool, but that's a logic test not an env test.
            console.log("ℹ️ Note: Check output for tool execution confirmation.");
        }

    } catch (error) {
        console.error("❌ E2E Test Failed:", error);
    }
}

testE2EAgent();
