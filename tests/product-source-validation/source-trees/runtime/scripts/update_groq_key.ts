
import fs from 'fs';
import path from 'path';

const TARGET_KEY = "GROQ_API_KEY";
// NOTE: Replace with your actual key or use: process.env.NEW_GROQ_KEY
const NEW_VALUE = process.env.NEW_GROQ_KEY || "YOUR_GROQ_API_KEY_HERE";
const ENV_PATH = path.resolve(process.cwd(), '.env.local');

try {
    let content = "";
    if (fs.existsSync(ENV_PATH)) {
        content = fs.readFileSync(ENV_PATH, 'utf8');
    }

    const lines = content.split(/\r?\n/);
    let found = false;
    let updated = false;

    const newLines = lines.map(line => {
        if (line.trim().startsWith(`${TARGET_KEY}=`)) {
            found = true;
            if (line.trim() !== `${TARGET_KEY}=${NEW_VALUE}`) {
                console.log(`🔄 Updating existing ${TARGET_KEY}...`);
                updated = true;
                return `${TARGET_KEY}=${NEW_VALUE}`;
            }
        }
        return line;
    });

    if (!found) {
        console.log(`Mw Adding new ${TARGET_KEY}...`);
        newLines.push(`${TARGET_KEY}=${NEW_VALUE}`);
        updated = true;
    }

    if (updated) {
        fs.writeFileSync(ENV_PATH, newLines.join('\n'), 'utf8');
        console.log("✅ .env.local updated successfully.");
    } else {
        console.log("✅ Key already exists and matches. No changes needed.");
    }

} catch (e: any) {
    console.error("❌ Error updating .env.local:", e.message);
}
