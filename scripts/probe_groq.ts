
import fs from 'fs';
import path from 'path';

// Manual .env parser
function loadEnv() {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        if (fs.existsSync(envPath)) {
            const fileContent = fs.readFileSync(envPath, 'utf8');
            fileContent.split(/\r?\n/).forEach(line => {
                const match = line.match(/^([^=]+)=(.*)$/);
                if (match) {
                    let val = match[2].trim();
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.slice(1, -1);
                    }
                    process.env[match[1].trim()] = val;
                }
            });
        }
    } catch (e) {
        console.warn("⚠️ Could not load .env.local");
    }
}
loadEnv();

async function probeGroq() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        console.error("❌ NO GROQ_API_KEY FOUND.");
        return;
    }

    console.log("🕵️ Probing Groq API...");
    console.log(`🔑 Key fragment: ${apiKey.substring(0, 8)}...`);

    // Models to test
    const models = [
        "openai/gpt-oss-120b", // The one we are currently trying to use
        "llama-3.3-70b-versatile", // Recommended fallback
        "llama-3.1-70b-versatile",
        "mixtral-8x7b-32768"
    ];

    for (const model of models) {
        console.log(`\n🧪 Testing Model: '${model}'...`);
        try {
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: "user", content: "Ping" }],
                    max_tokens: 10
                })
            });

            if (response.ok) {
                const json = await response.json();
                console.log(`✅ SUCCESS! '${model}' is working.`);
                console.log(`RESPONSE: ${json.choices[0]?.message?.content}`);
                // Don't break, test all to see what's available
            } else {
                const err = await response.text();
                console.error(`❌ FAILED '${model}'. Status: ${response.status}`);
                console.error(`ERROR: ${err}`);
            }
        } catch (e: any) {
            console.error(`❌ EXCEPTION for '${model}': ${e.message}`);
        }
    }
}

probeGroq();
