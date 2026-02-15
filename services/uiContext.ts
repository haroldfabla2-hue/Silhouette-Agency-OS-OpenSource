
import { ScreenContext, SensoryData } from "../types";
import { sensory } from "./sensoryService";
import { vfs } from "./virtualFileSystem";

// --- OMNISCIENT UI CONTEXT SERVICE ---
// The central nervous system for UI state tracking.
// Aggregates Tabs, Active Files, Metrics, and now SENSORY DATA.

class UiContextService {
    private currentContext: ScreenContext = {
        activeTab: 'dashboard',
        metrics: {
            activeAgents: 0,
            agentsInVram: 0,
            agentsInRam: 0,
            introspectionDepth: 32,
            awarenessScore: 0,
            fps: 0,
            currentMode: 'ECO' as any,
            tokenUsageToday: 0,
            currentStage: 'IDLE' as any,
            jsHeapSize: 0,
            vramUsage: 0,
            cpuTickDuration: 0,
            netLatency: 0,
            systemAlert: null
        }
    };

    private activeProjectId: string | null = null;

    public updateContext(partial: Partial<ScreenContext>) {
        this.currentContext = { ...this.currentContext, ...partial };
    }

    public setActiveProject(projectId: string | null) {
        this.activeProjectId = projectId;
    }

    public getContext(): ScreenContext {
        return this.currentContext;
    }

    public getActiveFileContent(): string | undefined {
        return this.currentContext.activeFile?.content;
    }

    // --- SENSORY GATHERING (NEW) ---
    public async gatherSensoryData(): Promise<SensoryData> {
        if (typeof window === 'undefined') {
            return { logs: [], semanticTree: [], projectIndex: undefined };
        }

        let visualSnapshot = undefined;
        let projectIndex = undefined;

        // 1. Capture Visuals if in Workspace
        if (this.currentContext.activeTab === 'dynamic_workspace') {
            visualSnapshot = await sensory.captureVisualContext('workspace-preview-container');

            // 2. Get Deep Project Index
            if (this.activeProjectId) {
                projectIndex = vfs.getProjectIndex(this.activeProjectId);
            }
        }

        // 3. Get Telemetry & Semantics
        const logs = sensory.getTelemetry();
        // Capture specific semantic tree of the main content area to avoid sidebar noise
        const semanticTree = sensory.getSemanticTree(document.querySelector('main') as HTMLElement || document.body);

        return {
            visualSnapshot,
            logs,
            semanticTree,
            projectIndex
        };
    }
}

export const uiContext = new UiContextService();
