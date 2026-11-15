
import { semanticMemory } from '../services/semanticMemory';
import { vectorMemory } from '../services/vectorMemoryService';
import { configureGenAI } from '../services/geminiService';

// 1. Configure
const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
if (!apiKey) {
    console.error("❌ API Key not found.");
    process.exit(1);
}
configureGenAI(apiKey);

// 2. Mock Long Document
const MARS_HISTORY = `
The Colonization of Mars: A 100-Year History

Chapter 1: The First Steps (2030-2040)
The first human landing on Mars occurred on July 20, 2032, led by the Ares V mission. Commander Sarah Jenkins took the first step, famously declaring "A new world for an old species." The initial base, Alpha Prime, was established in Valles Marineris to shield against radiation. Early years were plagued by dust storms and equipment failure, but the discovery of subsurface ice in 2035 changed everything.

Chapter 2: The Great Expansion (2040-2060)
With water secured, the colony grew rapidly. SpaceX and NASA merged operations to form the United Planetary Coalition (UPC). By 2050, the population reached 10,000. The first Martian-born human, Elara Vance, was born in 2045. This era saw the construction of the Great Dome, a pressurized city capable of sustaining agriculture.

Chapter 3: The Crisis of '62 (2060-2070)
A massive solar flare in 2062 knocked out communications with Earth for 6 months. The colony had to survive independently. This led to the "Martian Independence Movement." Rationing was strict, and the "Algae Riots" of 2064 threatened to destroy the fragile ecosystem. Order was restored by the Council of Elders.

Chapter 4: Terraforming Begins (2070-2100)
In 2075, the Atmospheric Processors were activated. These massive machines began releasing CO2 from the polar caps to thicken the atmosphere. By 2090, the sky turned from black to a deep purple. Lichen began to grow on the surface. The dream of a Green Mars was becoming reality.
`;

async function runTest() {
    console.log("🦖 Starting RAPTOR Test...");

    await vectorMemory.connect();

    // Ingest the document
    await semanticMemory.ingestDocument("History of Mars", MARS_HISTORY);

    console.log("✅ Ingestion Complete. Verifying Recall...");

    // Test Recall - High Level
    const summary = await semanticMemory.recall("What happened in the early years of Mars?", 3);
    console.log("\n🔍 Query: 'Early years'");
    summary.forEach(s => console.log(`- [L${s.level}] ${s.content.substring(0, 100)}...`));

    // Test Recall - Specific Detail
    const detail = await semanticMemory.recall("Who was the first Martian born?", 3);
    console.log("\n🔍 Query: 'First born'");
    detail.forEach(s => console.log(`- [L${s.level}] ${s.content.substring(0, 100)}...`));

    process.exit(0);
}

runTest().catch(console.error);
