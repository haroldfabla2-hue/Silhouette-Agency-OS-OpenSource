/**
 * POWER MANAGER SERVICE v2.0 - ADAPTIVE THROTTLING
 * All services run autonomously with CPU-based throttling
 */

import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';

export enum PowerMode {
    MINIMAL = 'MINIMAL',
    ECO = 'ECO',
    BALANCED = 'BALANCED',
    PERFORMANCE = 'PERFORMANCE',
    CONSCIOUS = 'CONSCIOUS' // [NEW] High Agency / Low CPU
}

interface PowerConfig {
    orchestratorTickMs: number;
    memoryMaintenanceMs: number;
    resourceArbiterMs: number;
    syncManagerMs: number;
    enableDreamer: boolean;
    enableCuriosity: boolean;
    enableLearningLoop: boolean;
    enableEvolution: boolean;
    enableNarrative: boolean; // [NEW] Stream of consciousness
    enableIntrospection: boolean; // [NEW] Self-awareness
    maxConcurrentAgents: number;
}

// All services enabled in BALANCED - throttling handles load
const POWER_CONFIGS: Record<PowerMode, PowerConfig> = {
    [PowerMode.MINIMAL]: {
        orchestratorTickMs: 30000,
        memoryMaintenanceMs: 120000,
        resourceArbiterMs: 30000,
        syncManagerMs: 60000,
        enableDreamer: false,
        enableCuriosity: false,
        enableLearningLoop: false,
        enableEvolution: false,
        enableNarrative: false,
        enableIntrospection: false,
        maxConcurrentAgents: 2
    },
    [PowerMode.ECO]: {
        orchestratorTickMs: 15000,
        memoryMaintenanceMs: 60000,
        resourceArbiterMs: 20000,
        syncManagerMs: 45000,
        enableDreamer: true,
        enableCuriosity: true,
        enableLearningLoop: false,
        enableEvolution: false,
        enableNarrative: false,
        enableIntrospection: true, // Basic awareness
        maxConcurrentAgents: 3
    },
    [PowerMode.BALANCED]: {
        orchestratorTickMs: 10000,
        memoryMaintenanceMs: 30000,
        resourceArbiterMs: 15000,
        syncManagerMs: 30000,
        enableDreamer: true,
        enableCuriosity: true,
        enableLearningLoop: true,
        enableEvolution: true,
        enableNarrative: true,      // ✅ Narrative active
        enableIntrospection: true,  // ✅ Self-awareness active
        maxConcurrentAgents: 5
    },
    [PowerMode.PERFORMANCE]: {
        orchestratorTickMs: 3000,
        memoryMaintenanceMs: 10000,
        resourceArbiterMs: 5000,
        syncManagerMs: 10000,
        enableDreamer: true,
        enableCuriosity: true,
        enableLearningLoop: true,
        enableEvolution: true,
        enableNarrative: true,
        enableIntrospection: true,
        maxConcurrentAgents: 10
    },
    [PowerMode.CONSCIOUS]: { // [NEW] "Living" but calm (Revised: Minutes-based)
        orchestratorTickMs: 15000,       // 15s Heartbeat
        memoryMaintenanceMs: 120000,     // 2 min Memory Cleanup
        resourceArbiterMs: 60000,        // 1 min Resource Check
        syncManagerMs: 60000,            // 1 min Sync
        enableDreamer: true,             // ✅ Dreaming active
        enableCuriosity: true,           // ✅ Curiosity active
        enableLearningLoop: true,        // ✅ Learning active
        enableEvolution: true,           // ✅ Self-evolution active
        enableNarrative: true,           // ✅ Stream of Consciousness (Narrator)
        enableIntrospection: true,       // ✅ Metacognition
        maxConcurrentAgents: 8           // ✅ High concurrency
    }
};

class PowerManager {
    private static instance: PowerManager;
    private currentMode: PowerMode = PowerMode.CONSCIOUS; // Default to Conscious for "Living OS" feel
    private listeners: Set<(mode: PowerMode, config: PowerConfig) => void> = new Set();

    // Adaptive throttling state
    private cpuLoad: number = 0;
    private throttleMultiplier: number = 1;
    private throttleCheckInterval: NodeJS.Timeout | null = null;

    private constructor() {
        console.log(`[POWER_MANAGER] ⚡ Initialized with mode: ${this.currentMode}`);
        this.startAdaptiveThrottling();
    }

    /**
     * ADAPTIVE THROTTLING
     * Monitors CPU and adjusts intervals automatically
     */
    private startAdaptiveThrottling() {
        // Check CPU every 30 seconds and adjust throttle
        this.throttleCheckInterval = setInterval(async () => {
            try {
                const si = await import('systeminformation');
                const load = await si.currentLoad();
                this.cpuLoad = load.currentLoad;

                // Calculate throttle multiplier based on CPU load
                if (this.cpuLoad > 80) {
                    this.throttleMultiplier = 3;  // Slow down 3x when CPU > 80%
                    console.log(`[POWER_MANAGER] 🔥 High CPU (${this.cpuLoad.toFixed(0)}%) - Throttling 3x`);
                } else if (this.cpuLoad > 60) {
                    this.throttleMultiplier = 2;  // Slow down 2x when CPU > 60%
                } else if (this.cpuLoad > 40) {
                    this.throttleMultiplier = 1.5;
                } else {
                    this.throttleMultiplier = 1;  // Normal speed when CPU < 40%
                }
            } catch (e) {
                // systeminformation not available, use default
                this.throttleMultiplier = 1;
            }
        }, 30000);

        // Staggered startup - delay service initialization
        console.log('[POWER_MANAGER] 🚀 Staggered startup enabled');
    }

    public static getInstance(): PowerManager {
        if (!PowerManager.instance) {
            PowerManager.instance = new PowerManager();
        }
        return PowerManager.instance;
    }

    public getMode(): PowerMode {
        return this.currentMode;
    }

    public getConfig(): PowerConfig {
        return POWER_CONFIGS[this.currentMode];
    }

    /**
     * Get throttled interval - applies CPU-based multiplier
     */
    public getThrottledInterval(baseMs: number): number {
        return Math.round(baseMs * this.throttleMultiplier);
    }

    public get orchestratorTickMs(): number {
        return this.getThrottledInterval(POWER_CONFIGS[this.currentMode].orchestratorTickMs);
    }

    public get memoryMaintenanceMs(): number {
        return this.getThrottledInterval(POWER_CONFIGS[this.currentMode].memoryMaintenanceMs);
    }

    public get isDreamerEnabled(): boolean {
        return POWER_CONFIGS[this.currentMode].enableDreamer;
    }

    public get isCuriosityEnabled(): boolean {
        return POWER_CONFIGS[this.currentMode].enableCuriosity;
    }

    public get isLearningLoopEnabled(): boolean {
        return POWER_CONFIGS[this.currentMode].enableLearningLoop;
    }

    public get isEvolutionEnabled(): boolean {
        return POWER_CONFIGS[this.currentMode].enableEvolution;
    }

    public get isNarrativeEnabled(): boolean {
        return POWER_CONFIGS[this.currentMode].enableNarrative;
    }

    public get isIntrospectionEnabled(): boolean {
        return POWER_CONFIGS[this.currentMode].enableIntrospection;
    }

    public get maxConcurrentAgents(): number {
        return POWER_CONFIGS[this.currentMode].maxConcurrentAgents;
    }

    public getCpuLoad(): number {
        return this.cpuLoad;
    }

    public getThrottleMultiplier(): number {
        return this.throttleMultiplier;
    }

    public setMode(mode: PowerMode): void {
        if (mode === this.currentMode) return;
        const oldMode = this.currentMode;
        this.currentMode = mode;
        console.log(`[POWER_MANAGER] ⚡ Mode: ${oldMode} → ${mode}`);

        this.listeners.forEach(l => l(mode, POWER_CONFIGS[mode]));
        systemBus.emit(SystemProtocol.UI_REFRESH, { type: 'POWER_MODE_CHANGED', mode }, 'POWER_MANAGER');
    }

    public subscribe(callback: (mode: PowerMode, config: PowerConfig) => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    public getAvailableModes(): { mode: PowerMode; description: string; recommended: boolean }[] {
        return [
            { mode: PowerMode.MINIMAL, description: 'Minimum - only essentials', recommended: false },
            { mode: PowerMode.ECO, description: 'Low resources - slow background', recommended: false },
            { mode: PowerMode.BALANCED, description: 'All autonomous + adaptive throttling', recommended: true },
            { mode: PowerMode.PERFORMANCE, description: 'Maximum responsiveness', recommended: false },
            { mode: PowerMode.CONSCIOUS, description: 'Living State - High Agency, Low CPU', recommended: true }
        ];
    }

    public getStatus(): object {
        return {
            mode: this.currentMode,
            cpuLoad: this.cpuLoad,
            throttleMultiplier: this.throttleMultiplier,
            effectiveTickMs: this.orchestratorTickMs,
            allServicesEnabled: this.currentMode === PowerMode.BALANCED || this.currentMode === PowerMode.PERFORMANCE || this.currentMode === PowerMode.CONSCIOUS
        };
    }
}

export const powerManager = PowerManager.getInstance();
export type { PowerConfig };
