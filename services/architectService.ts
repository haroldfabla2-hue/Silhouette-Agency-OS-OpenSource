
import { geminiService } from './geminiService';
import { CommunicationLevel } from '../types';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';

// --- ARCHITECT SERVICE (The Blueprint Maker) ---
// Turns abstract Research findings into concrete Technical Proposals (RFCs).

const BRAIN_DIR = path.join(process.cwd(), '.gemini/antigravity/brain'); // Hardcoded for Safety
const RFC_DIR = path.join(BRAIN_DIR, 'rfcs');

export class ArchitectService {

    constructor() {
        this.ensureDirectories();
    }

    private ensureDirectories() {
        if (!fs.existsSync(RFC_DIR)) {
            fs.mkdirSync(RFC_DIR, { recursive: true });
        }
    }

    public async generateRFC(researchContext: { title: string, findings: string, recommendation: string }): Promise<string | null> {
        console.log(`[ARCHITECT] 🏗️ Drafting RFC for: ${researchContext.title}`);

        const prompt = `
        You are the Chief Software Architect.
        TASK: Draft a technical "Request for Comments" (RFC) based on the following research.
        
        INPUT CONTEXT:
        Title: "${researchContext.title}"
        Findings: "${researchContext.findings}"
        Recommendation: "${researchContext.recommendation}"

        OUTPUT FORMAT (Markdown):
        # RFC-[UUID]: [Title]
        > Status: PROPOSED
        > Date: ${new Date().toISOString().split('T')[0]}

        ## 1. Summary
        [Executive summary of the proposal]

        ## 2. Motivation
        [Why do we need this? What problem does it solve?]

        ## 3. Proposed Design
        [Technical details, Components, Interfaces]

        ## 4. Risks & Mitigations
        [What could go wrong?]

        ## 5. Implementation Plan
        [Step-by-step checklist]
        `;

        const response = await geminiService.generateAgentResponse(
            "Code_Architect", "Architect", "CORE", prompt, null, undefined, undefined,
            { useWebSearch: false }, {}, [], CommunicationLevel.TECHNICAL, 'gemini-1.5-flash'
        );

        if (!response.output) return null;

        // Generate Filename
        const rfcId = uuidv4().substring(0, 8);
        const filename = `RFC-${rfcId}_${researchContext.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
        const filePath = path.join(RFC_DIR, filename);

        // Save Ticket
        fs.writeFileSync(filePath, response.output);
        console.log(`[ARCHITECT] 📄 RFC Saved: ${filePath}`);

        // Emit Protocol Event
        // Emit Protocol Event
        systemBus.emit(
            SystemProtocol.ARCHITECTURAL_RFC,
            {
                id: rfcId,
                path: filePath,
                summary: researchContext.title
            },
            'ArchitectService'
        );

        return filePath;
    }
}

export const architect = new ArchitectService();
