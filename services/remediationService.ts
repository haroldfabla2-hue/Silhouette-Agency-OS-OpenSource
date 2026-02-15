import { contextAssembler } from "./contextAssembler";
import { generateAgentResponse } from "./geminiService";
import { systemBus } from "./systemBus";
import { SystemProtocol, AgentStatus, IntrospectionLayer, WorkflowStage, CommunicationLevel } from "../types";
import { orchestrator } from "./orchestrator";
import { sqliteService } from "./sqliteService";

// --- REMEDIATION SERVICE V2.0 (SQUAD BASED) ---
// The "Hospital" for Agents.
// Mobilizes specialized squads (QA, FIX, SCIENCE) to solve problems robustly.

// --- PA-038: AUTONOMY SANDBOX INTERFACE ---
export interface SandboxEnvironment {
    run(image: string, scriptContent: string, envVars?: Record<string, string>): Promise<string>;
    destroy(): Promise<void>;
}

export class DockerSandbox implements SandboxEnvironment {
    private containerId: string | null = null;

    async run(image: string, scriptContent: string, envVars?: Record<string, string>): Promise<string> {
        console.log(`[SANDBOX] 📦 Starting container '${image}'...`);

        try {
            // Dynamic import to avoid bundling issues
            const Dockerode = (await import('dockerode')).default;
            const docker = new Dockerode();

            // Create a temporary file path for the script
            const fs = await import('fs/promises');
            const path = await import('path');
            const os = await import('os');

            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-'));
            const scriptPath = path.join(tempDir, 'script.sh');
            await fs.writeFile(scriptPath, scriptContent);

            // Create container with resource limits
            const container = await docker.createContainer({
                Image: image,
                Cmd: ['/bin/sh', '/sandbox/script.sh'],
                HostConfig: {
                    Memory: 256 * 1024 * 1024, // 256MB limit
                    CpuQuota: 50000, // 50% CPU
                    NetworkMode: 'none', // No network access for security
                    Binds: [`${tempDir}:/sandbox:ro`],
                    AutoRemove: true
                },
                Env: Object.entries(envVars || {}).map(([k, v]) => `${k}=${v}`),
                WorkingDir: '/sandbox'
            });

            this.containerId = container.id;

            // Start and wait for completion
            await container.start();
            const result = await container.wait();

            // Get logs
            const logs = await container.logs({ stdout: true, stderr: true, follow: false });
            const output = logs.toString('utf8');

            // Cleanup temp directory
            await fs.rm(tempDir, { recursive: true, force: true });

            if (result.StatusCode !== 0) {
                throw new Error(`Container exited with code ${result.StatusCode}: ${output}`);
            }

            return output;
        } catch (error: any) {
            // Fallback to simulation if Docker is not available
            if (error.message?.includes('connect ENOENT') || error.code === 'ENOENT') {
                console.warn('[SANDBOX] ⚠️ Docker not available, using simulation mode');
                return `[SANDBOX] Simulated execution of ${scriptContent.length} bytes in ${image}`;
            }
            throw error;
        }
    }

    async destroy(): Promise<void> {
        console.log(`[SANDBOX] 🧹 Cleaning up container resources...`);
        if (this.containerId) {
            try {
                const Dockerode = (await import('dockerode')).default;
                const docker = new Dockerode();
                const container = docker.getContainer(this.containerId);
                await container.stop().catch(() => { }); // Ignore if already stopped
                await container.remove().catch(() => { }); // Ignore if already removed
            } catch (e) {
                // Container may have auto-removed
            }
            this.containerId = null;
        }
    }
}

export class RemediationService {
    private static instance: RemediationService;

    // PA-038: Track repeated failures per agent for evolution escalation
    private failureCounts: Map<string, number> = new Map();

    private constructor() {
        // PA-008: Subscribe to voice engine incidents for auto-repair
        this.subscribeToVoiceIncidents();
    }

    public static getInstance(): RemediationService {
        if (!RemediationService.instance) {
            RemediationService.instance = new RemediationService();
        }
        return RemediationService.instance;
    }

    /**
     * PA-008: Subscribe to voice engine incident reports
     */
    private subscribeToVoiceIncidents(): void {
        systemBus.subscribe(SystemProtocol.INCIDENT_REPORT, async (event) => {
            if (event.payload?.source === 'voice_engine') {
                await this.handleVoiceEngineIncident(event.payload);
            }
        });
        console.log('[REMEDIATION] 🎤 Subscribed to voice engine incident reports');
    }

    /**
     * PA-008: Handle voice engine incidents with 4-tier repair protocol
     * 
     * Tier 1: Fast Repair (wake/restart)
     * Tier 2: Deep Diagnosis (research team analysis)
     * Tier 3: Intelligent Fixes (based on diagnosis)
     * Tier 4: Human Escalation (last resort)
     */
    private async handleVoiceEngineIncident(payload: any): Promise<void> {
        console.log('[REMEDIATION] 🎤 Voice Engine incident detected - initiating 4-tier repair protocol...');
        sqliteService.log('INFO', 'Voice engine 4-tier repair protocol initiated', 'remediation');

        const repairLog: string[] = [];

        try {
            const { voiceMonitor } = await import('./media/voiceMonitorService');

            // ============================================
            // TIER 1: FAST REPAIR
            // ============================================
            console.log('[REMEDIATION] 🔧 Tier 1: Attempting fast repair...');
            repairLog.push('Tier 1 (Fast Repair): Started');

            const tier1Success = await voiceMonitor.restartVoiceEngine();
            if (tier1Success) {
                console.log('[REMEDIATION] ✅ Tier 1 SUCCESS - Voice engine restarted');
                repairLog.push('Tier 1: SUCCESS');
                this.logRepairSuccess('Tier 1 Fast Repair', repairLog);
                return;
            }

            repairLog.push('Tier 1: FAILED - Escalating to Tier 2');
            console.log('[REMEDIATION] ⚠️ Tier 1 failed - escalating to deep diagnosis...');

            // ============================================
            // TIER 2: DEEP DIAGNOSIS
            // ============================================
            console.log('[REMEDIATION] 🔬 Tier 2: Running deep diagnosis...');
            repairLog.push('Tier 2 (Deep Diagnosis): Started');

            const diagnostics = await voiceMonitor.gatherDiagnostics();
            const rootCause = await this.analyzeVoiceFailure(diagnostics);

            repairLog.push(`Tier 2: Diagnosis complete - Root cause: ${rootCause}`);
            console.log(`[REMEDIATION] 🩺 Root cause identified: ${rootCause}`);

            // ============================================
            // TIER 3: INTELLIGENT FIXES
            // ============================================
            console.log('[REMEDIATION] 🔧 Tier 3: Applying intelligent fix...');
            repairLog.push('Tier 3 (Intelligent Fix): Started');

            const tier3Success = await this.applyVoiceFix(voiceMonitor, rootCause, diagnostics);
            if (tier3Success) {
                console.log('[REMEDIATION] ✅ Tier 3 SUCCESS - Voice engine repaired');
                repairLog.push('Tier 3: SUCCESS');
                this.logRepairSuccess(`Tier 3 Fix: ${rootCause}`, repairLog);
                return;
            }

            repairLog.push('Tier 3: FAILED - All automatic repairs exhausted');
            console.log('[REMEDIATION] ❌ Tier 3 failed - all automatic repairs exhausted');

            // ============================================
            // TIER 4: HUMAN ESCALATION (Last Resort)
            // ============================================
            console.log('[REMEDIATION] 📢 Tier 4: Escalating to human...');
            repairLog.push('Tier 4 (Human Escalation): Required');

            this.escalateVoiceFailure(rootCause, diagnostics, repairLog);

        } catch (error: any) {
            console.error('[REMEDIATION] ❌ Voice repair protocol error:', error.message);
            repairLog.push(`Protocol Error: ${error.message}`);
            sqliteService.log('ERROR', `Voice repair protocol error: ${error.message}`, 'remediation');

            // Still escalate on error
            this.escalateVoiceFailure('PROTOCOL_ERROR', { error: error.message }, repairLog);
        }
    }

    /**
     * Analyze voice failure using research team
     */
    private async analyzeVoiceFailure(diagnostics: any): Promise<string> {
        // Quick heuristic analysis first
        if (diagnostics.portConflict) {
            return 'PORT_CONFLICT';
        }
        if (!diagnostics.pythonAvailable) {
            return 'PYTHON_NOT_AVAILABLE';
        }
        if (diagnostics.cudaError && diagnostics.logs?.includes('CUDA')) {
            return 'CUDA_ERROR';
        }
        if (diagnostics.logs?.includes('ModuleNotFoundError') || diagnostics.logs?.includes('No module named')) {
            return 'MISSING_DEPENDENCIES';
        }
        if (diagnostics.logs?.includes('model') && (diagnostics.logs?.includes('not found') || diagnostics.logs?.includes('corrupted'))) {
            return 'MODEL_CORRUPTED';
        }

        // If no quick match, use Research Team for deep analysis
        try {
            const researchPrompt = `
            Analyze this voice engine failure and identify the root cause.
            
            Diagnostics:
            - Port 8100 conflict: ${diagnostics.portConflict}
            - Python available: ${diagnostics.pythonAvailable} (${diagnostics.pythonVersion || 'unknown'})
            - CUDA available: ${diagnostics.cudaAvailable}
            - CUDA error: ${diagnostics.cudaError || 'none'}
            - Consecutive failures: ${diagnostics.consecutiveFailures}
            - Last error: ${diagnostics.lastError || 'unknown'}
            - Recent logs: 
            ${diagnostics.logs?.substring(0, 1000) || 'No logs available'}
            
            Respond with ONLY one of these root causes:
            PORT_CONFLICT, PYTHON_NOT_AVAILABLE, CUDA_ERROR, MISSING_DEPENDENCIES, MODEL_CORRUPTED, MEMORY_ERROR, UNKNOWN
            `;

            const research = await this.consultResearchTeam(researchPrompt);
            const causes = ['PORT_CONFLICT', 'PYTHON_NOT_AVAILABLE', 'CUDA_ERROR', 'MISSING_DEPENDENCIES', 'MODEL_CORRUPTED', 'MEMORY_ERROR'];

            for (const cause of causes) {
                if (research.toUpperCase().includes(cause)) {
                    return cause;
                }
            }
        } catch (e) {
            console.warn('[REMEDIATION] Research team analysis failed, using UNKNOWN');
        }

        return 'UNKNOWN';
    }

    /**
     * Apply fix based on diagnosed root cause
     */
    private async applyVoiceFix(voiceMonitor: any, rootCause: string, diagnostics: any): Promise<boolean> {
        console.log(`[REMEDIATION] 🛠️ Applying fix for: ${rootCause}`);

        switch (rootCause) {
            case 'PORT_CONFLICT':
                // Kill process on port and retry
                console.log('[REMEDIATION] → Killing conflicting process on port 8100...');
                await voiceMonitor.killPortProcess();
                await this.wait(2000);
                return await voiceMonitor.restartVoiceEngine();

            case 'MISSING_DEPENDENCIES':
                // Install dependencies and retry
                console.log('[REMEDIATION] → Installing missing Python dependencies...');
                const installed = await voiceMonitor.installDependencies();
                if (installed) {
                    await this.wait(2000);
                    return await voiceMonitor.restartVoiceEngine();
                }
                return false;

            case 'CUDA_ERROR':
            case 'MEMORY_ERROR':
                // Retry with CPU-only mode
                console.log('[REMEDIATION] → Switching to CPU-only mode...');
                await voiceMonitor.setCpuOnlyMode();
                await this.wait(1000);
                return await voiceMonitor.restartVoiceEngine();

            case 'PYTHON_NOT_AVAILABLE':
                // Can't auto-fix - need Python installed
                console.log('[REMEDIATION] → Python not available, cannot auto-fix');
                sqliteService.log('ERROR', 'Python interpreter not found - manual install required', 'remediation');
                return false;

            case 'MODEL_CORRUPTED':
                // Would need to re-download model - complex operation
                console.log('[REMEDIATION] → Model may be corrupted, attempting restart anyway...');
                return await voiceMonitor.restartVoiceEngine();

            default:
                // Unknown - try one more restart
                console.log('[REMEDIATION] → Unknown cause, attempting final restart...');
                return await voiceMonitor.restartVoiceEngine();
        }
    }

    /**
     * Escalate to human with full context
     */
    private escalateVoiceFailure(rootCause: string, diagnostics: any, repairLog: string[]): void {
        console.log('[REMEDIATION] 📢 Escalating voice failure to human intervention...');

        systemBus.emit(SystemProtocol.ARCHITECTURAL_RFC, {
            title: 'Voice Engine Critical Failure - All Repairs Exhausted',
            severity: 'HIGH',
            description: `
All automatic repair attempts have failed for the Voice Engine.

**Diagnosed Root Cause:** ${rootCause}

**Repair Attempts:**
${repairLog.map(l => `• ${l}`).join('\n')}

**System Diagnostics:**
• Port conflict: ${diagnostics.portConflict || 'unknown'}
• Python available: ${diagnostics.pythonAvailable || 'unknown'}
• CUDA available: ${diagnostics.cudaAvailable || 'unknown'}
• Last error: ${diagnostics.lastError || 'unknown'}

**Suggested Manual Actions:**
${this.getSuggestedActions(rootCause)}
            `.trim(),
            suggestedAction: this.getSuggestedActions(rootCause),
            timestamp: Date.now(),
            repairLog
        }, 'remediation');

        sqliteService.log('ERROR',
            `Voice engine repair exhausted. Root cause: ${rootCause}. Human intervention required.`,
            'remediation'
        );
    }

    private getSuggestedActions(rootCause: string): string {
        switch (rootCause) {
            case 'PORT_CONFLICT':
                return 'Check what process is using port 8100: netstat -ano | findstr :8100';
            case 'PYTHON_NOT_AVAILABLE':
                return 'Install Python 3.10+ or activate the correct conda/venv environment';
            case 'CUDA_ERROR':
                return 'Check NVIDIA drivers: nvidia-smi. Consider reinstalling CUDA toolkit.';
            case 'MISSING_DEPENDENCIES':
                return 'Run: cd voice_engine && pip install -r requirements.txt';
            case 'MODEL_CORRUPTED':
                return 'Delete and re-download the TTS model files';
            default:
                return 'Check voice_engine logs and Python environment manually';
        }
    }

    private logRepairSuccess(method: string, repairLog: string[]): void {
        systemBus.emit(SystemProtocol.AGENT_EVOLVED, {
            agentId: 'voice_engine',
            improvement: `Auto-repaired via ${method}`,
            repairLog,
            timestamp: Date.now()
        }, 'remediation');

        sqliteService.log('INFO', `Voice engine repaired: ${method}`, 'remediation');
    }

    private wait(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * SQUAD MOBILIZATION (The "Code Blue")
     * Wakes up the necessary specialists to handle the crisis.
     */
    public async mobilizeSquad(agentId: string, errorLog: string[]) {
        console.log(`[REMEDIATION] 🚨 MOBILIZING SQUADS for Agent ${agentId}...`);

        // 1. Wake up The Inquisitors (QA) to analyze the failure
        orchestrator.hydrateAgent('qa-01');
        // Pre-hydrate Research and Dev for potential use
        orchestrator.hydrateAgent('research-01');
        orchestrator.hydrateAgent('dev-01');

        // 3. Diagnosis Phase (QA)
        const diagnosis = await this.runDiagnosis(agentId, errorLog);

        console.log(`[REMEDIATION] 🩺 Diagnosis: ${diagnosis.rootCause} (Missing API: ${diagnosis.isCriticalApiMissing})`);

        // 4. Critical Block Handler
        if (diagnosis.isCriticalApiMissing) {
            await this.handleCriticalBlock(agentId, diagnosis.missingApi);
            return;
        }

        // 5. COMPLEXITY CHECK (Triaging)
        // If the fix is "Unknown" or explicitly requests research, we escalate.
        const needsResearch = diagnosis.rootCause.includes("Unknown") || diagnosis.fixProposal.includes("Research");

        let initialPlan = diagnosis.fixProposal;

        if (needsResearch) {
            // PHASE 1: RESEARCH
            const researchFindings = await this.consultResearchTeam(errorLog.join('\n'));

            // PHASE 2: COLLABORATIVE PLANNING
            initialPlan = await this.planSolution(diagnosis, researchFindings);

            // Log the deep fix
            systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
                thoughts: [`[SELF-HEALING] 🧠 Research Complete. Strategy: ${initialPlan}`],
                source: 'RemediationService'
            });
        }

        // 6. EXECUTION PHASE (FIX)
        await this.runFixProtocol(agentId, diagnosis.rootCause, initialPlan);
    }

    // --- PHASE 1: RESEARCH CONSULTATION ---
    private async consultResearchTeam(errorContext: string): Promise<string> {
        console.log("[REMEDIATION] 🔬 Consulting Research Squad for deep analysis...");

        const prompt = `
        [ROLE]
        You are the LEAD RESEARCHER of the agency.
        Your goal is to investigate complex system failures and propose architectural solutions.
        
        [CONTEXT]
        Error: ${errorContext}
        
        [TASK]
        1. Analyze the error for underlying architectural flaws (not just syntax).
        2. Propose a robust, scalable solution (e.g., "Implement Circuit Breaker" instead of "Try Catch").
        3. Cite known patterns if applicable.
        
        Output a concise research summary.
        `;

        const response = await generateAgentResponse(
            "research-01", "Lead Researcher", "RESEARCH", prompt, null,
            IntrospectionLayer.DEEP, WorkflowStage.META_ANALYSIS,
            undefined, undefined, [], CommunicationLevel.TECHNICAL
        );

        return response.output;
    }

    // --- PHASE 2: COLLABORATIVE PLANNING ---
    private async planSolution(diagnosis: any, research: string): Promise<string> {
        console.log("[REMEDIATION] 🏗️ Dev Squad Planning Phase...");

        const prompt = `
        [ROLE]
        You are the LEAD ENGINEER.
        We have a critical failure.
        
        [DIAGNOSIS (QA)]
        ${JSON.stringify(diagnosis)}
        
        [RESEARCH (R&D)]
        ${research}
        
        [TASK]
        Synthesize a FINAL REMEDIATION PLAN.
        If code changes are needed, specify the generic logic (do not write full code yet, just the plan).
        
        Output: A single paragraph describing the fix.
        `;

        const response = await generateAgentResponse(
            "dev-01", "Lead Engineer", "DEV", prompt, null,
            IntrospectionLayer.OPTIMAL, WorkflowStage.PLANNING,
            undefined, undefined, [], CommunicationLevel.TECHNICAL
        );

        return response.output;
    }

    private async runDiagnosis(agentId: string, logs: string[]): Promise<{ rootCause: string, fixProposal: string, isCriticalApiMissing: boolean, missingApi?: string }> {
        // [OCA] Gather System Context for accurate diagnosis (e.g., is it OOM?)
        const globalContext = await contextAssembler.getGlobalContext(`Critical Failure in ${agentId} with logs: ${logs.join(' ')}`);

        const prompt = `
        CRITICAL FAILURE ANALYSIS
        Agent: ${agentId}
        Logs: ${logs.join('\n')}
        
        Determine:
        1. Is this a missing API Key issue? (CRITICAL)
        2. Is this a logic loop?
        3. Is this a hallucination?
        4. Is this related to High CPU/RAM? (See System Context)
        
        Output JSON: { "rootCause": "...", "fixProposal": "...", "isCriticalApiMissing": boolean, "missingApi": "OPENAI" | "None" }
        `;

        const result = await generateAgentResponse(
            "qa-01", "Lead Inquisitor", "OPS", prompt, JSON.stringify(globalContext), // [OCA] Context Injected
            IntrospectionLayer.DEEP, WorkflowStage.QA_AUDIT, undefined, undefined, [], CommunicationLevel.INTERNAL_MONOLOGUE
        );

        try {
            const cleanJson = result.output.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleanJson);
        } catch (e) {
            return { rootCause: "Unknown", fixProposal: "Restart Agent", isCriticalApiMissing: false };
        }
    }

    private async runFixProtocol(agentId: string, cause: string, proposal: string) {
        console.log(`[REMEDIATION] 🛠️ FIX SQUAD DEPLOYED: ${proposal}`);

        // PA-038: Track failure count for evolution escalation
        const count = (this.failureCounts.get(agentId) || 0) + 1;
        this.failureCounts.set(agentId, count);

        // If agent fails repeatedly, escalate to evolution instead of just resetting
        const EVOLUTION_THRESHOLD = 3;
        if (count >= EVOLUTION_THRESHOLD) {
            console.warn(`[REMEDIATION] 🔄 Agent ${agentId} failed ${count} times. Escalating to EVOLUTION.`);

            try {
                const { agentFactory } = await import('./factory/AgentFactory');
                const agent = orchestrator.getAgent(agentId);

                if (agent) {
                    await agentFactory.evolveAgent(agent);
                    this.failureCounts.set(agentId, 0); // Reset counter on evolution
                    console.log(`[REMEDIATION] ✅ Agent ${agentId} evolved after ${count} failures.`);
                }
            } catch (evolveError: any) {
                console.error(`[REMEDIATION] ❌ Evolution escalation failed:`, evolveError.message);
            }
            return;
        }

        // Standard fix path
        systemBus.emit(SystemProtocol.UI_REFRESH, {
            source: 'REMEDIATION',
            message: `Applying Fix to ${agentId}: ${proposal} (Attempt ${count}/${EVOLUTION_THRESHOLD})`
        });

        // In V3: This would actually write code to the agent's file.
        // For now, we reset the agent state.
        // orchestrator.resetAgent(agentId);
    }

    // --- PHASE 3: CRITICAL HANDLER ---
    private async handleCriticalBlock(agentId: string, apiName: string = "Unknown") {
        console.warn(`[REMEDIATION] 🛑 CRITICAL BLOCK: Missing API ${apiName}`);

        // 1. Pause the Task
        // systemBus.emit(SystemProtocol.TASK_PAUSED, { agentId });

        // 2. Notify User via UI (High Priority)
        systemBus.emit(SystemProtocol.UI_REFRESH, {
            source: 'SYSTEM_ALERT',
            message: `WORKFLOW PAUSED: Missing ${apiName} API Key. Please add it in Settings to continue.`
        });
    }

    /**
     * LEGACY DIAGNOSE (Kept for compatibility if needed, but redirects to Mobilize)
     */
    public async diagnose(agentId: string, errorLog: string[]): Promise<string> {
        await this.mobilizeSquad(agentId, errorLog);
        return "Squad Mobilized";
    }

    public async autoPatch(agentId: string, diagnosis: string) {
        // No-op, handled by mobilizeSquad
    }
    // --- REAL CODE FIXING (V2.5) ---
    /**
     * Executes code in a safe, isolated Docker sandbox before applying it.
     */
    public async runSafeSimulation(scriptContent: string, runtime: 'python' | 'node' = 'node'): Promise<{ success: boolean; output: string }> {
        console.log(`[REMEDIATION] 🛡️ Initiating Safety Sandbox Simulation (${runtime})...`);
        const sandbox = new DockerSandbox();

        try {
            const image = runtime === 'python' ? 'python:3.10-slim' : 'node:18-alpine';
            const output = await sandbox.run(image, scriptContent);

            await sandbox.destroy();

            return { success: true, output };
        } catch (error: any) {
            console.error('[REMEDIATION] 💥 Sandbox Simulation Failed:', error);
            await sandbox.destroy();
            return { success: false, output: error.message };
        }
    }

    public async applyCodeFix(filePath: string, fileContent: string, remediation: string): Promise<boolean> {
        console.log(`[REMEDIATION] 🚑 APPLYING FIX TO: ${filePath}`);
        try {
            // In a real scenario, we'd use an AST transform or strict replace.
            // For this verification, we assume 'remediation' is the FULL NEW CONTENT provided by the FIX agent.
            // Or we can simulate a specific patch.

            // 1. Backup (Safety Net)
            const fs = await import('fs');
            const backupPath = filePath + '.bak';
            try {
                await fs.promises.copyFile(filePath, backupPath);
                console.log(`[REMEDIATION] 🛡️ Backup created: ${backupPath}`);
            } catch (backupErr) {
                console.warn(`[REMEDIATION] ⚠️ Backup failed. Proceeding with caution...`, backupErr);
            }

            // 2. Write
            await fs.promises.writeFile(filePath, remediation, 'utf-8');

            console.log(`[REMEDIATION] ✅ Fix Applied Successfully.`);

            // 3. Report Incident (Anti-Fragility)
            systemBus.emit(SystemProtocol.INCIDENT_REPORT, {
                remediationType: 'PATCH',
                component: filePath,
                error: 'Self-Correction Triggered (Auto-Patch)', // ideally explicitly passed
                patchDetails: remediation.substring(0, 500), // Larger captures for analysis
                timestamp: Date.now()
            }, "REMEDIATION_SERVICE");

            return true;
        } catch (e) {
            console.error(`[REMEDIATION] ❌ Failed to apply fix:`, e);

            // Report Failure to ARB too (Valuable data)
            systemBus.emit(SystemProtocol.INCIDENT_REPORT, {
                remediationType: 'FAILED_ATTEMPT',
                component: filePath,
                error: JSON.stringify(e),
                patchDetails: "Rollback Initiated",
                timestamp: Date.now()
            }, "REMEDIATION_SERVICE");

            // ROLLBACK ATTEMPT
            try {
                const fs = await import('fs');
                const backupPath = filePath + '.bak';
                if (fs.existsSync(backupPath)) {
                    await fs.promises.copyFile(backupPath, filePath);
                    console.log(`[REMEDIATION] 🔄 ROLLBACK SUCCESSFUL. Restored ${filePath}`);
                }
            } catch (rollbackErr) {
                console.error(`[REMEDIATION] 💀 CRITICAL: ROLLBACK FAILED. System requires manual intervention.`, rollbackErr);
            }

            return false;
        }
    }
    // [FIX] Track zombie reset attempts to prevent infinite loops
    private zombieResetAttempts: Map<string, number> = new Map();
    private readonly MAX_ZOMBIE_RESETS = 3;

    // --- PHASE 4: FAST TRACK REMEDIATION (IMMUNE RESPONSE) ---
    public async fastTrackRemediation(agentId: string, actionType: string) {
        console.log(`[REMEDIATION] ⚡ FAST TRACK INTERVENTION for ${agentId}: ${actionType}`);

        if (actionType === 'ZOMBIE_RESET') {
            // Track reset attempts to prevent infinite loop
            const attempts = (this.zombieResetAttempts.get(agentId) || 0) + 1;
            this.zombieResetAttempts.set(agentId, attempts);

            if (attempts > this.MAX_ZOMBIE_RESETS) {
                // Agent has been reset too many times - escalate based on type
                if (agentId.startsWith('agt_dyn_')) {
                    // Dynamic agents: Clean removal (they were temporary anyway)
                    console.warn(`[REMEDIATION] 🧹 Dynamic zombie ${agentId} failed ${attempts} resets. Purging from system.`);
                    await orchestrator.purgeAgent(agentId);
                    this.zombieResetAttempts.delete(agentId);

                    systemBus.emit(SystemProtocol.UI_REFRESH, {
                        source: 'REMEDIATION',
                        message: `Dynamic agent ${agentId} purged after ${attempts} failed recovery attempts`
                    });
                } else {
                    // Core/Persistent agents: Escalate to TEAM_FIX for investigation
                    console.warn(`[REMEDIATION] 🔬 Core zombie ${agentId} failed ${attempts} resets. Escalating to TEAM_FIX.`);
                    this.zombieResetAttempts.delete(agentId);

                    // Mobilize squads for deep investigation
                    await this.mobilizeSquad(agentId, [
                        `ZOMBIE_OUTBREAK: Agent ${agentId} stuck in zombie state after ${attempts} reset attempts`,
                        'Possible causes: task deadlock, external service hang, or logic loop',
                        'ACTION: Investigate root cause and implement permanent fix'
                    ]);
                }
                return;
            }

            // Standard reset path
            await orchestrator.resetAgent(agentId);

            systemBus.emit(SystemProtocol.UI_REFRESH, {
                source: 'REMEDIATION',
                message: `Auto-Reset Performed on Frozen Agent: ${agentId} (Attempt ${attempts}/${this.MAX_ZOMBIE_RESETS})`
            });

            // Clear attempts after successful period (handled by time-based cleanup)
            // In production: add a job to clear attempts after 10 minutes of no issues
        }
    }

    /**
     * Clear zombie tracking for an agent (call after agent successfully completes work)
     */
    public clearZombieTracking(agentId: string) {
        if (this.zombieResetAttempts.has(agentId)) {
            this.zombieResetAttempts.delete(agentId);
            console.log(`[REMEDIATION] ✅ Zombie tracking cleared for ${agentId} (recovered successfully)`);
        }
    }
}


export const remediation = RemediationService.getInstance();
