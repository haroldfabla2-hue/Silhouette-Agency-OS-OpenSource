
import { InstallationState, SystemMap, UserRole } from "../types";
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

        // Simulate activating the Installation Squad
        this.log("Activating 'Code_Scanner' agent...");
        await this.simulateDelay(1000);
        this.state.progress = 20;
        this.log("Scanning Frontend Components...");

        // In a real server environment, we would use fs.readdir here.
        // For the browser demo, we construct the map based on the known app structure.
        const map = await this.performDeepScan();

        this.state.progress = 60;
        this.state.currentStep = 'MAPPING';
        this.log("Activating 'DB_Cartographer' agent...");
        await this.simulateDelay(1000);
        this.log("Mapping Database Schema & Relationships...");
        this.state.progress = 90;

        this.state.systemMap = map;
        this.state.currentStep = 'HANDOVER';
        this.saveState();

        await this.handoverToOrchestrator(map);
    }

    private async performDeepScan(): Promise<SystemMap> {
        // This represents the result of the agents analyzing the code base
        // In the real backend (server/index.ts), this logic traverses the actual file system.
        return {
            scanTimestamp: Date.now(),
            frontendComponents: [
                'Dashboard.tsx', 'AgentOrchestrator.tsx', 'IntrospectionHub.tsx',
                'ContinuumMemoryExplorer.tsx', 'SystemControl.tsx', 'ChatWidget.tsx', 'InstallationWizard.tsx'
            ],
            backendEndpoints: [
                '/v1/chat/completions', '/v1/workflow/task', '/v1/memory/query',
                '/v1/introspection/analyze', '/v1/integration/analyze'
            ],
            databaseSchema: [
                'MemoryNode (id, content, tier)',
                'Agent (id, role, status)',
                'ConceptVector (id, vector, strength)',
                'Project (id, client, status)'
            ],
            rolePolicy: {
                [UserRole.SUPER_ADMIN]: ['*'],
                [UserRole.ADMIN]: ['dashboard', 'orchestrator', 'memory'],
                [UserRole.WORKER_L1]: ['tasks'],
                [UserRole.WORKER_L2]: ['tasks', 'docs'],
                [UserRole.CLIENT]: ['project_view', 'support_chat'],
                [UserRole.VISITOR]: []
            }
        };
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

    private simulateDelay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
