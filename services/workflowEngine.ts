import { WorkflowStage, AutonomousConfig, IntrospectionLayer, WorkflowMutation, SystemMode, SystemProtocol, MorphPayload } from "../types";
import { orchestrator } from "./orchestrator";
import { continuum } from "./continuumMemory";
import { generateAgentResponse } from "./geminiService";
import { introspection } from "./introspectionEngine";
import { systemBus } from "./systemBus";
import { MOCK_PROJECTS, DEFAULT_API_CONFIG } from "../constants";
import { contextResolver } from './contextResolver';
import { visualCortex } from './visualCortex';
import { CommunicationLevel } from "../types"; // Import from types
// [NEURAL LOOP IMPORTS]
import { qualityControl } from "./qualityControlService";
import { remediation } from "./remediationService";
import { architect } from "./architectService"; // [PHASE 8]

class WorkflowEngine {
  // ... (properties)
  private currentStage: WorkflowStage = WorkflowStage.IDLE;
  private config: AutonomousConfig;
  private tokenUsage: number = 0;
  private isProcessing: boolean = false;
  private lastThoughts: string[] = [];

  private lastQualityScore: number = 100;
  private remediationAttempts: number = 0;
  private MAX_REMEDIATION_ATTEMPTS: number = 3;

  private failures: number = 0;
  private circuitOpen: boolean = false;
  private circuitResetTime: number = 0;
  private readonly FAILURE_THRESHOLD = 3;
  private readonly RESET_TIMEOUT = 30000;

  private pipelineData: any = {};

  constructor() {

    this.config = {
      enabled: false,
      mode24_7: false,
      allowEvolution: false,
      smartPaging: false,
      maxRunTimeHours: 4,
      maxDailyTokens: 500000,
      safeCleanup: true
    };

    // [INTEGRITY FIX] Listen for Distributed Agent Results
    // This allows sub-agents to trigger protocols (Create File, Run Test, etc.)
    systemBus.subscribe(SystemProtocol.TASK_COMPLETION, async (event) => {
      if (event.payload.result) {
        console.log(`[WORKFLOW] 🔗 Integrating Result from ${event.payload.agentId}`);
        // Use the Robust Neural Feedback Loop
        await this.handleDistributedResult(event.payload.agentId, event.payload.result);
      }
    });

    // Handle standard research requests too
    systemBus.subscribe(SystemProtocol.RESEARCH_REQUEST, async (event) => {
      // Logic for research protocols if needed
    });
  }

  public updateConfig(newConfig: AutonomousConfig) {
    this.config = newConfig;
  }

  public getStage(): WorkflowStage {
    return this.currentStage;
  }

  public getTokenUsage(): number {
    return this.tokenUsage;
  }

  public getLastThoughts(): string[] {
    return this.lastThoughts;
  }

  public getLastQualityScore(): number {
    return this.lastQualityScore;
  }

  public async tick() {
    if (!this.config.enabled) {
      this.currentStage = WorkflowStage.IDLE;
      return;
    }

    if (this.circuitOpen) {
      if (Date.now() > this.circuitResetTime) {
        this.circuitOpen = false;
        this.failures = 0;
      } else {
        return;
      }
    }

    if (this.config.mode24_7) {
      await this.monitorLongRunningContext();
    }

    if (this.checkLimits() || this.isProcessing) return;

    switch (this.currentStage) {
      case WorkflowStage.IDLE:
        if (this.config.mode24_7) this.startNewCycle();
        break;

      case WorkflowStage.INTENT:
        // 1. Analyze Intent & Research Needs
        const intentAnalysis = await this.analyzeIntentAndResearchNeeds();

        if (intentAnalysis.needsResearch) {
          console.log("[WORKFLOW] 🧠 Research required. Delegating to Swarm...");
          systemBus.emit(SystemProtocol.RESEARCH_REQUEST, { query: intentAnalysis.query }, 'WORKFLOW_ENGINE'); // Notify UI

          try {
            // 2. Async Request to Research Squad (e.g., 'ctx-01' is the leader of TEAM_CONTEXT)
            // In a real swarm, we'd broadcast to 'TEAM_CONTEXT' and a free agent would pick it up.
            // For now, we target the leader.
            const researchResult = await systemBus.request(
              'ctx-01',
              SystemProtocol.RESEARCH_REQUEST,
              { query: intentAnalysis.query },
              `TRACE_${Date.now()}`
            );

            console.log("[WORKFLOW] 🎓 Research Complete:", researchResult.payload.data.substring(0, 50) + "...");

            // 3. Store Knowledge
            this.pipelineData.researchContext = researchResult.payload.data;
            this.pipelineData.intent = intentAnalysis.refinedIntent; // Use refined intent

            this.transitionTo(WorkflowStage.PLANNING);

          } catch (e) {
            console.error("[WORKFLOW] Research failed, proceeding with limited context.", e);
            this.pipelineData.intent = intentAnalysis.originalIntent;
            this.transitionTo(WorkflowStage.PLANNING);
          }
        } else {
          this.pipelineData.intent = intentAnalysis.originalIntent;
          this.transitionTo(WorkflowStage.PLANNING);
        }
        break;

      case WorkflowStage.PLANNING:
        // Intent-based Transition
        // If the 'intent' analysis specifically requested a NEW APP, we go to GENESIS.
        // Otherwise, standard plan.
        const intent = this.pipelineData.intent || "";
        if (intent.toLowerCase().includes("new app") || intent.toLowerCase().includes("create project")) {
          this.transitionTo(WorkflowStage.GENESIS);
        } else {
          await this.executeStageTask("Create plan.", "OPS", "Strategos_X", WorkflowStage.EXECUTION);
        }
        break;

      case WorkflowStage.GENESIS:
        await this.executeGenesisSpawn();
        break;

      case WorkflowStage.EXECUTION:
        await this.executeStageTask("Execute plan.", "DEV", "Code_Architect", WorkflowStage.QA_AUDIT);
        break;

      case WorkflowStage.QA_AUDIT:
        await this.executeQARound();
        break;

      case WorkflowStage.REMEDIATION:
        await this.executeRemediationRound();
        break;

      case WorkflowStage.OPTIMIZATION:
        await this.executeStageTask("Optimize.", "OPS", "Improver_V9", WorkflowStage.ARCHIVAL);
        break;

      case WorkflowStage.ARCHIVAL:
        this.performArchival();
        this.config.allowEvolution ? this.transitionTo(WorkflowStage.META_ANALYSIS) : this.transitionTo(WorkflowStage.IDLE);
        break;

      case WorkflowStage.META_ANALYSIS:
        await this.executeMetaAnalysis();
        break;

      case WorkflowStage.ADAPTATION_QA:
        this.isProcessing = false;
        this.transitionTo(WorkflowStage.IDLE);
        break;
    }
  }

  private async executeGenesisSpawn() {
    this.isProcessing = true;
    try {
      console.log("[WORKFLOW] Entering GENESIS phase. Spawning child application...");

      // 1. Call AI to design the app architecture
      const response = await generateAgentResponse(
        "System_Architect",
        "Genesis Architect",
        "INTEGRATION",
        "Design a new 'Analytics Dashboard' application. Define folder structure.",
        null,
        IntrospectionLayer.MAXIMUM,
        WorkflowStage.GENESIS,
        undefined,
        {},
        [],
        CommunicationLevel.EXECUTIVE // Architect is Executive
      );

      this.tokenUsage += response.usage;

      // [PHASE 13] Universal Asset Pipeline: Generate Visuals in Parallel
      const projectName = `App_${Date.now()}`;
      const creativeContext = contextResolver.resolveFromProject('REACT_VITE', projectName);

      visualCortex.initiateHybridFlow({
        id: `req_${Date.now()}`,
        prompt: "Modern SaaS Dashboard Landing Page Hero",
        brandId: "GENESIS_PROJECT",
        aspectRatio: '16:9',
        outputType: 'IMAGE'
      }, creativeContext).then(asset => {
        console.log("[WORKFLOW] Universal Asset Pipeline: Visual Cortex generated asset:", asset.id);
      }).catch(e => console.warn("[WORKFLOW] Visual Cortex failed:", e));

      // 2. Trigger Factory Spawn (Simulated API call)
      try {
        const res = await fetch(`http://localhost:${DEFAULT_API_CONFIG.port}/v1/factory/spawn`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}`
          },
          body: JSON.stringify({ name: projectName, template: 'REACT_VITE' })
        });
        if (res.ok) {
          const data = await res.json();
          systemBus.emit(SystemProtocol.SQUAD_EXPANSION, { name: 'Genesis_Ops', category: 'INTEGRATION', role: 'Deployment' });
        }
      } catch (e) {
        console.error("Genesis Factory API failed", e);
      }

      this.transitionTo(WorkflowStage.QA_AUDIT);
    } catch (e) {
      this.recordFailure();
    } finally {
      this.isProcessing = false;
    }
  }

  private async monitorLongRunningContext() {
    const stats = await continuum.getStats();
    if (stats.total > 200 && !this.isProcessing) {
      this.isProcessing = true;
      try {
        const response = await generateAgentResponse(
          "Context_Overseer",
          "Supervisor",
          "DATA",
          "Compress logs.",
          null,
          IntrospectionLayer.MEDIUM,
          WorkflowStage.OPTIMIZATION,
          undefined,
          {},
          [],
          CommunicationLevel.TECHNICAL // Overseer is Technical
        );
        continuum.store(response.output, 'LONG' as any, ['SAGA']);
        systemBus.emit(SystemProtocol.MEMORY_FLUSH, { message: `Archived Context` });
      } catch (e) { console.error(e); } finally { this.isProcessing = false; }
    }
  }

  private startNewCycle() {
    this.pipelineData = {};
    this.lastQualityScore = 0;
    this.remediationAttempts = 0;
    this.transitionTo(WorkflowStage.INTENT);
  }

  private transitionTo(stage: WorkflowStage) {
    this.currentStage = stage;
    console.log(`[WORKFLOW] 🔄 Transitioning to Stage: ${stage}`);
    systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, { stage: stage, status: 'started' });

    // [DISTRIBUTED ORCHESTRATION] Wake up relevant squads
    orchestrator.activateSquadsForStage(stage, this.pipelineData);
  }

  private recordFailure() {
    this.failures++;
    const morph: MorphPayload = { mode: 'DEFENSE', accentColor: 'red', density: 'compact' };
    systemBus.emit(SystemProtocol.INTERFACE_MORPH, morph, 'SECURITY');
    if (this.failures >= this.FAILURE_THRESHOLD) {
      this.circuitOpen = true;
      this.circuitResetTime = Date.now() + this.RESET_TIMEOUT;
      this.isProcessing = false;
      systemBus.emit(SystemProtocol.SECURITY_LOCKDOWN, { message: 'Circuit Breaker Active' });
    }
  }

  private recordSuccess() { this.failures = 0; }

  private async executeQARound() {
    this.isProcessing = true;
    try {
      const input = this.pipelineData.draftResult || "No draft.";
      const response = await generateAgentResponse(
        "QA_Inquisitor",
        "Auditor",
        "OPS",
        "Audit.",
        input,
        IntrospectionLayer.MAXIMUM,
        WorkflowStage.QA_AUDIT,
        undefined,
        {},
        [],
        CommunicationLevel.TECHNICAL // Auditor is Technical
      );
      this.recordSuccess();
      this.tokenUsage += response.usage;
      this.lastThoughts = response.thoughts;
      this.lastQualityScore = response.qualityScore || 85;
      this.pipelineData.qaReport = response.output;

      if (this.lastQualityScore < 90) systemBus.emit(SystemProtocol.INTERFACE_MORPH, { mode: 'DEFENSE' }, 'QA');

      if (this.lastQualityScore >= 98 || this.remediationAttempts >= this.MAX_REMEDIATION_ATTEMPTS) {
        systemBus.emit(SystemProtocol.INTERFACE_MORPH, { mode: 'FLOW' }, 'QA');
        this.transitionTo(WorkflowStage.OPTIMIZATION);
      } else {
        this.transitionTo(WorkflowStage.REMEDIATION);
      }
    } catch (e) { this.recordFailure(); } finally { this.isProcessing = false; }
  }

  private async executeRemediationRound() {
    this.isProcessing = true;
    try {
      const combined = `DRAFT:\n${this.pipelineData.draftResult}\n\nREPORT:\n${this.pipelineData.qaReport}`;
      const response = await generateAgentResponse(
        "Fixer_Unit",
        "Mechanic",
        "DEV",
        "Fix.",
        combined,
        IntrospectionLayer.DEEP,
        WorkflowStage.REMEDIATION,
        undefined,
        {},
        [],
        CommunicationLevel.TECHNICAL // Fixer is Technical
      );
      this.recordSuccess();
      this.tokenUsage += response.usage;
      this.pipelineData.draftResult = response.output;
      this.remediationAttempts++;
      await this.checkAndApplyProtocols(response.output);
      this.transitionTo(WorkflowStage.QA_AUDIT);
    } catch (e) { this.recordFailure(); } finally { this.isProcessing = false; }
  }

  private async executeStageTask(task: string, category: string, role: string, next: WorkflowStage) {
    this.isProcessing = true;
    try {
      const prev = this.currentStage === WorkflowStage.OPTIMIZATION ? this.pipelineData.draftResult : this.pipelineData.intent;

      // Determine Level based on Stage
      const level = this.currentStage === WorkflowStage.PLANNING ? CommunicationLevel.EXECUTIVE : CommunicationLevel.TECHNICAL;

      const response = await generateAgentResponse(
        role,
        role,
        category,
        task,
        prev,
        IntrospectionLayer.OPTIMAL,
        this.currentStage,
        undefined,
        {},
        [],
        level
      );
      this.recordSuccess();
      this.tokenUsage += response.usage;
      this.lastThoughts = response.thoughts;
      await this.checkAndApplyProtocols(response.output);
      if (this.currentStage === WorkflowStage.INTENT) this.pipelineData.intent = response.output;
      if (this.currentStage === WorkflowStage.EXECUTION) this.pipelineData.draftResult = response.output;
      this.transitionTo(next);
    } catch (e) { this.recordFailure(); } finally { this.isProcessing = false; }
  }

  /**
   * [NEURAL FEEDBACK LOOP]
   * The core robustness mechanism.
   * 1. Evaluates Quality (Gatekeeper)
   * 2. Triggers Remediation (Self-Healing)
   * 3. Injects Context (Transcendence)
   * 4. Executes Protocols (Action)
   */
  private async handleDistributedResult(agentId: string, result: string) {
    // 1. QA Gate
    const qa = await qualityControl.evaluateText(result);

    if (qa.score < 70) {
      console.warn(`[WORKFLOW] 🛑 REJECTED output from ${agentId} (Score: ${qa.score}). Reason: ${qa.feedback}`);
      // 2. Remediation Trigger
      await remediation.mobilizeSquad(agentId, [`QA_FAILURE: ${qa.feedback}`]);
      return; // Stop. Do not execute protocols.
    }

    // 3. Context Transcendence (Memory Injection)
    // Store successful reasoning for future agents
    await continuum.store(
      `[AGENT_RESULT] ${agentId} via Neural Link:\n${result.substring(0, 500)}...`,
      IntrospectionLayer.DEEP as any,
      ['AGENT_OUTPUT', 'SUCCESS', agentId]
    );

    // 4. Protocol Execution (The Action)
    await this.checkAndApplyProtocols(result);
  }

  private async checkAndApplyProtocols(output: string) {
    // [PHASE 8] Tool Protocol Detection

    // 1. RFC Request: [REQUEST_RFC: Title | Findings | Recommendation]
    const rfcMatch = output.match(/\[REQUEST_RFC:\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\]/i);
    if (rfcMatch) {
      console.log(`[WORKFLOW] 📜 RFC Request Detected: ${rfcMatch[1]}`);
      await architect.generateRFC({
        title: rfcMatch[1].trim(),
        findings: rfcMatch[2].trim(),
        recommendation: rfcMatch[3].trim()
      });
    }

    // 2. Memory Write: [AUTHORIZE_MEMORY: Content]
    const memoryMatch = output.match(/\[AUTHORIZE_MEMORY:\s*(.*?)\]/i);
    if (memoryMatch) {
      console.log(`[WORKFLOW] 💾 Saving Memory via Protocol.`);
      await continuum.store(memoryMatch[1].trim(), IntrospectionLayer.DEEP as any, ['PROTOCOL_WRITE']);
    }
    // 3. Start Campaign: [START_CAMPAIGN: Brief]
    const campaignMatch = output.match(/\[START_CAMPAIGN:\s*(.*?)\]/i);
    if (campaignMatch) {
      console.log(`[WORKFLOW] 🎬 Creative Director Protocol Detected: ${campaignMatch[1]}`);
      const { creativeDirector } = await import('./skills/creativeDirectorSkill');
      await creativeDirector.execute(campaignMatch[1].trim());
    }

    // 4. Granular Image: [GENERATE_IMAGE: Prompt]
    const imageMatch = output.match(/\[GENERATE_IMAGE:\s*(.*?)\]/i);
    if (imageMatch) {
      console.log(`[WORKFLOW] 🎨 Granular Image Protocol Detected.`);
      const { creativeDirector } = await import('./skills/creativeDirectorSkill');
      await creativeDirector.generateVisual(imageMatch[1].trim());
    }

    // 5. Granular Video: [GENERATE_VIDEO: Prompt]
    const videoMatch = output.match(/\[GENERATE_VIDEO:\s*(.*?)\]/i);
    if (videoMatch) {
      console.log(`[WORKFLOW] 🎥 Granular Video Protocol Detected.`);
      const { creativeDirector } = await import('./skills/creativeDirectorSkill');
      await creativeDirector.generateMotion(videoMatch[1].trim());
    }
  }

  private async executeMetaAnalysis() {
    this.isProcessing = true;
    try {
      const response = await generateAgentResponse(
        "Workflow_Architect",
        "Evolutionist",
        "CORE",
        "Analyze.",
        null,
        IntrospectionLayer.DEEP,
        WorkflowStage.META_ANALYSIS,
        undefined,
        {},
        [],
        CommunicationLevel.EXECUTIVE // Evolutionist is Executive
      );
      this.tokenUsage += response.usage;
      this.transitionTo(WorkflowStage.ADAPTATION_QA);
    } catch (e) { this.transitionTo(WorkflowStage.IDLE); } finally { this.isProcessing = false; }
  }

  private performArchival() {
    continuum.store("Cycle Done.", undefined, ['archival']);
  }

  private async analyzeIntentAndResearchNeeds(): Promise<{ needsResearch: boolean, query?: string, refinedIntent?: string, originalIntent: string }> {
    // Ask Gemini to classify the user's request
    // We assume the 'intent' is stored in pipelineData or we fetch the last user message from Continuum/Chat
    // For this simulation, we'll assume we have a way to get the latest input. 
    // In a real implementation, we'd pass the input to tick() or store it in pipelineData.input.

    // REAL DATA: Fetch latest user input from Volatile Memory (RAM)
    const volatile = continuum.getVolatileState();
    // find last node with tag 'user-input'
    const lastUserNode = volatile.reverse().find(n => n.tags.includes('user-input'));
    const input = lastUserNode ? lastUserNode.content : "No recent input."; // Fallback only if memory empty

    if (input === "No recent input.") {
      return { needsResearch: false, originalIntent: input };
    }

    // We use a lightweight check here or a full LLM call
    // For robustness, let's do a quick LLM check
    const response = await generateAgentResponse(
      "Intent_Router",
      "Router",
      "CORE",
      `Analyze this request: "${input}". 
             Return JSON: { "needsResearch": boolean, "searchQuery": string, "refinedIntent": string }`,
      null,
      IntrospectionLayer.SHALLOW,
      WorkflowStage.INTENT,
      undefined,
      {},
      [],
      CommunicationLevel.TECHNICAL // Router is Technical
    );

    try {
      const json = JSON.parse(response.output.replace(/```json/g, '').replace(/```/g, ''));
      return {
        needsResearch: json.needsResearch,
        query: json.searchQuery,
        refinedIntent: json.refinedIntent,
        originalIntent: input
      };
    } catch (e) {
      // Fallback
      return { needsResearch: false, originalIntent: input };
    }
  }

  private checkLimits(): boolean {
    if (this.tokenUsage >= this.config.maxDailyTokens) {
      this.config.enabled = false;
      return true;
    }
    return false;
  }
}

export const workflowEngine = new WorkflowEngine();
