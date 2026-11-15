
// import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Manual .env parser
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

const GROQ_API_KEY = process.env.GROQ_API_KEY;

console.log("Testing Groq with Key length:", GROQ_API_KEY ? GROQ_API_KEY.length : 0);

async function testGroq() {
    if (!GROQ_API_KEY) {
        console.error("No API Key found");
        return;
    }

    try {
        console.log("Sending request to Groq (llama-3.1-70b-versatile)...");
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.1-70b-versatile",
                messages: [
                    { role: "system", content: "You are a test system." },
                    { role: "user", content: "Say 'System Operational' if you can hear me." }
                ],
                temperature: 0.1
            })
        });

        if (!response.ok) {
            console.error("Groq Error:", response.status, await response.text());
            return;
        }

        const json = await response.json();
        console.log("Groq Response:", json.choices[0].message.content);
        console.log("Usage:", json.usage);

    } catch (e) {
        console.error("Test Failed:", e);
    }
}

testGroq();
