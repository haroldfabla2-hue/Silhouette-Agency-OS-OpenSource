import { BaseAgent } from './BaseAgent';
import { Agent } from '../../types';

/**
 * StandardAgent
 * 
 * A concrete implementation of BaseAgent that can be hydrated directly
 * from the JSON profiles defined in constants.ts (like KERNEL_HEROS or 
 * SPECIALIST_LIBRARY).
 */
export class StandardAgent extends BaseAgent {
    constructor(config: Agent) {
        super(config);

        // Optionally bind specific loaded logic or extra configurations here.
        if (config.systemInstruction) {
            // If the profile holds legacy instructional data, we can preserve it
            this.thoughtProcess.push("[SYSTEM] Bootstrapped with legacy instructions.");
        }
    }

    /**
     * Extends the BaseAgent's getSystemPrompt to include any dynamically
     * loaded instructions typical of the old Profile system.
     */
    protected getSystemPrompt(): string {
        const base = super.getSystemPrompt();
        return base + "\n\nCRITICAL CONTEXT: You are fully operational and connected to the Hive Mind.\n";
    }
}
