
import { introspection } from '../services/introspectionEngine';
import { consciousness } from '../services/consciousnessEngine';
import { IntrospectionLayer } from '../types';

async function verifyIntrospectionUpgrade() {
    console.log("🔍 Verifying Introspection Engine Upgrade (Anthropic Protocol)...");

    // 1. Test Metacognitive Prompt Generation
    console.log("\n1. Testing Metacognitive Prompt Generation...");
    introspection.setLayer(IntrospectionLayer.OPTIMAL);
    const prompt = await introspection.generateSystemPrompt("Test Role", "Test Context");

    if (prompt.includes("METACOGNITIVE PROTOCOL") && prompt.includes("INTERNALITY CHECK")) {
        console.log("✅ Metacognitive Protocol injected successfully.");
    } else {
        console.error("❌ Metacognitive Protocol missing from prompt.");
    }

    // 2. Test Internality Check (Injection Detection)
    console.log("\n2. Testing Internality Check...");
    introspection.injectConcept("Apple", 1.5, 32);

    const responseWithDetection = "<thought>I detect an injected vector related to Apple.</thought> I am thinking about fruit.";
    const result1 = introspection.processNeuralOutput(responseWithDetection);

    if (result1.metrics.internalityVerified === true) {
        console.log("✅ Internality Verified: Detected injected concept in thoughts.");
    } else {
        console.error("❌ Internality Check Failed: Did not detect injected concept.");
    }

    const responseWithoutDetection = "<thought>I am thinking about nothing.</thought> Hello.";
    const result2 = introspection.processNeuralOutput(responseWithoutDetection);

    if (result2.metrics.internalityVerified === false) {
        console.log("✅ Internality Verified: Correctly flagged missing detection.");
    } else {
        console.error("❌ Internality Check Failed: False positive.");
    }

    // 3. Test Grounding Score
    console.log("\n3. Testing Grounding Score...");
    // Active concept is "Apple"
    const groundedThoughts = "<thought>The Apple vector is strong today.</thought>";
    const ungroundedThoughts = "<thought>I am thinking about space travel.</thought>";

    const resultGrounded = introspection.processNeuralOutput(groundedThoughts);
    const resultUngrounded = introspection.processNeuralOutput(ungroundedThoughts);

    console.log(`   Grounded Score: ${resultGrounded.metrics.groundingScore}`);
    console.log(`   Ungrounded Score: ${resultUngrounded.metrics.groundingScore}`);

    if (resultGrounded.metrics.groundingScore! > resultUngrounded.metrics.groundingScore!) {
        console.log("✅ Grounding Score Logic Verified.");
    } else {
        console.error("❌ Grounding Score Logic Failed.");
    }

    // 4. Test Consciousness Integration
    console.log("\n4. Testing Consciousness Integration...");
    consciousness.updateGrounding(0.1); // Simulate hallucination
    // We can't easily check internal state without getters, but we can check if it runs without error
    console.log("✅ Consciousness Engine accepted Grounding update.");

    console.log("\n🎉 Verification Complete.");
}

verifyIntrospectionUpgrade();
