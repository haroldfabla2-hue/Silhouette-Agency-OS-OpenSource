
import { InstallationState, SystemMap } from "../types";
import { DEFAULT_API_CONFIG } from "../constants";

// --- INSTALLATION & ONBOARDING SERVICE ---
// Manages the initial scan, key validation, and knowledge transfer to the Orchestrator.

class InstallationService {
    private state: InstallationState;

    constructor() {
        // Try to recover state from disk (persistence)
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('silhouette_install_state');
            if (saved) {
                this.state = JSON.parse(saved);
            } else {
                this.resetState();
            }
        } else {
            this.resetState();
        }
    }

    private resetState() {
        this.state = {
            isInstalled: false,
            currentStep: 'KEYS',
            progress: 0,
            logs: [],
            systemMap: null,
            apiKeys: {}
        };
    }

    public getState(): InstallationState {
        return this.state;
    }

    public updateKeys(keys: { gemini?: string; openai?: string }) {
        this.state.apiKeys = { ...this.state.apiKeys, ...keys };
        this.log("Keys updated securely.");
        this.saveState();
    }

    public async startScan() {
        if (!this.state.apiKeys.gemini) {
            this.log("ERROR: Missing Gemini API Key. Scan aborted.");
            return;
        }

        this.state.currentStep = 'SCANNING';
        this.state.progress = 0;
        this.saveState();

        // Real scan: the server traverses the actual filesystem and database.
        this.log("Requesting real system scan from backend...");
        this.state.progress = 20;

        const map = await this.performRealScan();
        if (!map) {
            this.log("ERROR: Real scan failed. The system map was NOT generated - nothing was fabricated. Check that the backend is reachable.");
            this.state.currentStep = 'KEYS';
            this.state.progress = 0;
            this.saveState();
            return;
        }

        this.state.progress = 60;
        this.state.currentStep = 'MAPPING';
        this.log(`Scan complete: ${map.frontendComponents.length} components, ${map.backendEndpoints.length} endpoints, ${map.databaseSchema.length} tables found.`);
        this.state.progress = 90;

        this.state.systemMap = map;
        this.state.currentStep = 'HANDOVER';
        this.saveState();

        await this.handoverToOrchestrator(map);
    }

    private async performRealScan(): Promise<SystemMap | null> {
        try {
            const response = await fetch(`http://localhost:${DEFAULT_API_CONFIG.port}/v1/system/install/scan`);
            if (!response.ok) {
                throw new Error(`Scan endpoint returned HTTP ${response.status}`);
            }
            const map = await response.json();
            if (!map || !Array.isArray(map.frontendComponents)) {
                throw new Error('Scan endpoint returned an invalid system map');
            }
            return map as SystemMap;
        } catch (error) {
            console.error('Real system scan failed', error);
            return null;
        }
    }

    private async handoverToOrchestrator(map: SystemMap) {
        this.log("Transferring System Map to Continuum Memory...");

        try {
            // Send map to backend via API instead of direct service call
            const response = await fetch(`http://localhost:${DEFAULT_API_CONFIG.port}/v1/system/install/handover`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ map })
            });

            if (!response.ok) {
                throw new Error(`Handover failed: ${response.statusText}`);
            }

            this.log("Knowledge Transfer Complete.");
            this.state.isInstalled = true;
            this.state.currentStep = 'COMPLETE';
            this.state.progress = 100;
            this.saveState();

            // Notify Orchestrator to wake up (via API implicitly or explicit call if needed)
            // The backend endpoint should handle waking up the orchestrator

        } catch (error) {
            console.error("Installation handover failed", error);
            this.log(`ERROR: Handover failed - ${error}`);
        }
    }

    private log(msg: string) {
        this.state.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
        // Keep log size manageable
        if (this.state.logs.length > 50) this.state.logs.shift();
    }

    private saveState() {
        if (typeof window !== 'undefined') {
            localStorage.setItem('silhouette_install_state', JSON.stringify(this.state));
        }
    }


    // Reset for testing purposes
    public hardReset() {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('silhouette_install_state');
        }
        this.resetState();
    }
}

export const installer = new InstallationService();
