import { ResourceScope, ScopeClosingError } from '../../server/runtime/resourceScope';
import { ownChild, execOwned, type ChildReceipt } from '../../server/runtime/childOwnership';
/**
 * Voice Monitor Service
 * 
 * Monitors voice engine health and integrates with Silhouette's autonomy stack:
 * - Emits events via systemBus for introspection visibility
 * - Triggers self-repair on consecutive failures
 * - Logs voice quality issues for qualityControl
 * 
 * @module services/media/voiceMonitorService
 */

import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';
import { sqliteService } from '../sqliteService';

interface VoiceEngineHealth {
    status: 'ONLINE' | 'SLEEPING' | 'OFFLINE';
    model?: string;
    device?: string;
    cuda?: boolean;
    lastCheck?: number;
}

interface VoiceStats {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageLatency: number;
    lastError?: string;
}

export interface PendingVoiceAction {
    id:number;
    action:'STOP_OWNED_ENGINE'|'INSTALL_DEPENDENCIES'|'RESTART_ENGINE'|'VERIFY_ENGINE_ATTRIBUTION';
    state:'PENDING_AUTHORIZATION'|'PENDING_ATTRIBUTION_AND_CONTAINMENT';
    reason:string;
    parameters:Record<string,unknown>;
}
class VoiceMonitorService {
    private readonly pendingVoiceActions:PendingVoiceAction[]=[];
    public getPendingVoiceActions():PendingVoiceAction[] {return this.pendingVoiceActions.map(x=>({...x,parameters:{...x.parameters}}));}
    private pendVoiceAction(action:PendingVoiceAction['action'],state:PendingVoiceAction['state'],reason:string,parameters:Record<string,unknown>={}):void {
        if(!this.pendingVoiceActions.some(p=>p.action===action&&p.state===state&&p.reason===reason&&JSON.stringify(p.parameters)===JSON.stringify(parameters))) this.pendingVoiceActions.push({id:this.pendingVoiceActions.length+1,action,state,reason,parameters});
        this.operations.recordDiagnostic('voice-action-pending:'+action,new Error(reason),'UNCLASSIFIED','UNVERIFIED');
    }

    private readonly operations=new ResourceScope('voice-monitor');
    private readonly children:ChildReceipt[]=[];
    private engine?:ReturnType<typeof ownChild>;
    private restartTask?:Promise<boolean>;
    public getLifecycleStatus(){return {pendingVoiceActions:this.getPendingVoiceActions(),children:this.children,diagnostics:this.operations.getDiagnostics(),failures:this.operations.getFailures()};}
    public shutdown(){this.stopMonitoring();return this.operations.close();}
    private execute(command:string,options:import('child_process').ExecOptions={}) {
        return execOwned(this.operations,'voice-command',command,this.children,options);
    }
    private wait(milliseconds:number):Promise<void> {
        this.operations.signal.throwIfAborted();
        return new Promise<void>((resolve,reject)=>{
            const done=()=>{clearTimeout(timer);this.operations.signal.removeEventListener('abort',abort);};
            const abort=()=>{done();reject(this.operations.signal.reason??new ScopeClosingError('voice-monitor'));};
            const timer=setTimeout(()=>{done();resolve();},milliseconds);
            this.operations.signal.addEventListener('abort',abort,{once:true});
            if(this.operations.signal.aborted)abort();
        });
    }
    private async http<T>(url:string,method:string,read:(response:Response)=>Promise<T>):Promise<T> {
        this.operations.assertAccepting();
        const controller=new AbortController();
        const release=this.operations.own({name:'voice-http',stopIntake:()=>controller.abort(),close:()=>controller.abort()});
        const timer=setTimeout(()=>controller.abort(),5000);
        let response:Response|undefined;
        try {
            response=await fetch(url,{method,signal:controller.signal});
            return await read(response);
        } finally {
            clearTimeout(timer);
            if(response?.body&&!response.bodyUsed) {
                try {await response.body.cancel();}catch(error){this.operations.recordFailure('voice-http-body-cleanup',error);}
            }
            await release();
        }
    }
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private consecutiveFailures = 0;
    private lastHealthStatus: 'ONLINE' | 'SLEEPING' | 'OFFLINE' = 'OFFLINE';
    private stats: VoiceStats = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageLatency: 0
    };

    private voiceEngineUrl = process.env.VOICE_ENGINE_URL || 'http://localhost:8100';
    private checkIntervalMs = 30000; // 30 seconds
    private maxConsecutiveFailures = 3;

    /**
     * Start the monitoring loop
     */
    startMonitoring(): void {
        this.operations.assertWorkAccepted();

        if (this.healthCheckInterval) {
            console.log('[VoiceMonitor] Already running');
            return;
        }

        console.log('[VoiceMonitor] Starting health monitoring...');
        this.operations.assertAccepting();
        this.healthCheckInterval = setInterval(() => {
            if(this.operations.accepting) void this.checkHealth().catch(()=>{/* scope retains */});
        }, this.checkIntervalMs);
        const timer=this.healthCheckInterval;
        this.operations.own({name:'voice-monitor-timer',stopIntake:()=>clearInterval(timer),close:()=>clearInterval(timer)});

        // Initial check
        void this.checkHealth().catch(()=>{/* scope retains */});
    }

    /**
     * Stop the monitoring loop
     */
    stopMonitoring(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
            console.log('[VoiceMonitor] Stopped monitoring');
        }
    }

    /**
     * Check voice engine health
     */
    async checkHealth(): Promise<VoiceEngineHealth> {
        return this.operations.run('checkHealth',async()=>{

        if (process.env.ENABLE_VOICE_ENGINE !== 'true') {
            this.lastHealthStatus = 'OFFLINE';
            return { status: 'OFFLINE', lastCheck: Date.now() };
        }

        try {
            const startTime = Date.now();
            const data = await this.http<VoiceEngineHealth>(`${this.voiceEngineUrl}/health`,'GET',async response => await response.json() as VoiceEngineHealth);
            const latency = Date.now() - startTime;
            this.operations.signal.throwIfAborted();
            data.lastCheck = Date.now();

            // Update stats
            this.updateLatency(latency);

            // Status transition: OFFLINE -> ONLINE
            if (data.status === 'ONLINE' && this.lastHealthStatus === 'OFFLINE') {
                console.log('[VoiceMonitor] ✅ Voice Engine came ONLINE');
                systemBus.emit(SystemProtocol.VOICE_ENGINE_ONLINE, {
                    timestamp: Date.now(),
                    device: data.device,
                    model: data.model,
                    cuda: data.cuda
                }, 'voice_monitor');

                this.consecutiveFailures = 0;
                sqliteService.log('INFO', 'Voice Engine is now ONLINE', 'voice_monitor');
            }

            // Status transition: ONLINE -> SLEEPING
            if (data.status === 'SLEEPING' && this.lastHealthStatus === 'ONLINE') {
                console.log('[VoiceMonitor] 💤 Voice Engine is SLEEPING (VRAM freed)');
                // Not an error, just noting the state
            }

            this.lastHealthStatus = data.status;
            this.consecutiveFailures = 0;

            return data;

        } catch (error: any) {
            if(this.operations.signal.aborted)throw error;

            this.operations.recordDiagnostic('checkHealth',error,'DEGRADED_FALLBACK','UNVERIFIED');

            if(this.operations.signal.aborted) throw error;
            this.operations.recordDiagnostic('voice-health',error,'DEGRADED_FALLBACK','UNAVAILABLE');
            this.consecutiveFailures++;
            this.stats.failedRequests++;
            this.stats.lastError = error.message;

            // Status transition: ONLINE -> OFFLINE
            if (this.lastHealthStatus !== 'OFFLINE') {
                console.warn(`[VoiceMonitor] ⚠️ Voice Engine went OFFLINE: ${error.message}`);
                systemBus.emit(SystemProtocol.VOICE_ENGINE_OFFLINE, {
                    timestamp: Date.now(),
                    error: error.message,
                    consecutiveFailures: this.consecutiveFailures
                }, 'voice_monitor');

                this.lastHealthStatus = 'OFFLINE';
                sqliteService.log('WARN', `Voice Engine OFFLINE: ${error.message}`, 'voice_monitor');
            }

            // Trigger self-repair after max consecutive failures
            if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
                await this.requestSelfRepair();
            }

            return {
                status: 'OFFLINE',
                lastCheck: Date.now()
            };
        }
    
        });
    }

    /**
     * Request self-repair via systemBus
     */
    private async requestSelfRepair(): Promise<void> {
        return this.operations.run('requestSelfRepair',async()=>{
        this.operations.assertAccepting();

        console.warn(`[VoiceMonitor] 🔧 Requesting self-repair (${this.consecutiveFailures} consecutive failures)`);

        // Emit incident for remediation
        systemBus.emit(SystemProtocol.INCIDENT_REPORT, {
            source: 'voice_engine',
            type: 'ENGINE_OFFLINE',
            severity: 'MEDIUM',
            message: `Voice Engine has been offline for ${this.consecutiveFailures} consecutive checks`,
            autoRepairAttempted: true,
            suggestedAction: 'Restart voice_engine process or check Python environment'
        }, 'voice_monitor');

        sqliteService.log('ERROR',
            `Voice Engine offline for ${this.consecutiveFailures} checks - self-repair requested`,
            'voice_monitor'
        );

        // Reset counter to avoid spamming
        this.consecutiveFailures = 0;
    
        });
    }

    /**
     * Record a TTS request for statistics
     */
    recordTTSRequest(success: boolean, latencyMs: number, error?: string): void {
        this.operations.assertWorkAccepted();

        this.stats.totalRequests++;

        if (success) {
            this.stats.successfulRequests++;
            this.updateLatency(latencyMs);
        } else {
            this.stats.failedRequests++;
            this.stats.lastError = error;

            // Emit TTS error event
            systemBus.emit(SystemProtocol.VOICE_TTS_ERROR, {
                timestamp: Date.now(),
                error,
                successRate: this.getSuccessRate()
            }, 'voice_monitor');

            sqliteService.log('ERROR', `TTS Error: ${error}`, 'voice_engine');
        }
    }

    /**
     * Record voice quality score for monitoring
     */
    recordVoiceQuality(voiceId: string, qualityScore: number): void {
        this.operations.assertWorkAccepted();

        if (qualityScore < 60) {
            console.warn(`[VoiceMonitor] Voice ${voiceId} has low quality: ${qualityScore}/100`);

            systemBus.emit(SystemProtocol.VOICE_QUALITY_LOW, {
                voiceId,
                qualityScore,
                timestamp: Date.now()
            }, 'voice_monitor');

            sqliteService.log('WARN',
                `Voice ${voiceId} quality score ${qualityScore}/100 (below threshold)`,
                'voice_quality'
            );
        }
    }

    /**
     * Emit clone start event
     */
    emitCloneStart(voiceId: string, inputDuration: number): void {
        this.operations.assertWorkAccepted();

        systemBus.emit(SystemProtocol.VOICE_CLONE_START, {
            voiceId,
            inputDuration,
            timestamp: Date.now()
        }, 'voice_clone');
    }

    /**
     * Emit clone complete event
     */
    emitCloneComplete(voiceId: string, qualityScore: number): void {
        this.operations.assertWorkAccepted();

        systemBus.emit(SystemProtocol.VOICE_CLONE_COMPLETE, {
            voiceId,
            qualityScore,
            timestamp: Date.now()
        }, 'voice_clone');

        sqliteService.log('INFO', `Voice cloned: ${voiceId} (quality: ${qualityScore})`, 'voice_clone');
    }

    /**
     * Emit clone failed event
     */
    emitCloneFailed(voiceId: string, error: string): void {
        this.operations.assertWorkAccepted();

        systemBus.emit(SystemProtocol.VOICE_CLONE_FAILED, {
            voiceId,
            error,
            timestamp: Date.now()
        }, 'voice_clone');

        sqliteService.log('ERROR', `Voice clone failed: ${voiceId} - ${error}`, 'voice_clone');
    }

    /**
     * Get current monitoring stats
     */
    getStats(): VoiceStats & {
        currentStatus: string;
        successRate: number;
        isMonitoring: boolean;
    } {
        this.operations.assertWorkAccepted();

        return {
            ...this.stats,
            currentStatus: this.lastHealthStatus,
            successRate: this.getSuccessRate(),
            isMonitoring: this.healthCheckInterval !== null
        };
    }

    /**
     * Get current health status without making a request
     */
    getCurrentStatus(): 'ONLINE' | 'SLEEPING' | 'OFFLINE' {
        this.operations.assertWorkAccepted();

        return this.lastHealthStatus;
    }

    private updateLatency(latencyMs: number): void {
        // Running average
        const totalSamples = this.stats.successfulRequests || 1;
        this.stats.averageLatency =
            (this.stats.averageLatency * (totalSamples - 1) + latencyMs) / totalSamples;
    }

    private getSuccessRate(): number {
        if (this.stats.totalRequests === 0) return 100;
        return Math.round((this.stats.successfulRequests / this.stats.totalRequests) * 100);
    }

    /**
     * Attempt to restart the voice engine
     * First tries /wake endpoint, then spawns new Python process
     */
    restartVoiceEngine():Promise<boolean> {
        if(this.restartTask)return this.restartTask;
        const task=this.restartVoiceEngineOnce();this.restartTask=task;
        void task.then(()=>{if(this.restartTask===task)this.restartTask=undefined;},()=>{if(this.restartTask===task)this.restartTask=undefined;});
        return task;
    }
    private async restartVoiceEngineOnce(): Promise<boolean> {
        return this.operations.run('restartVoiceEngineOnce',async()=>{

        // A direct shell close is NOT proof its workers are gone. No wake,
        // spawn or other restart effect may run after an unresolved prior child.
        if(this.engine || this.pendingVoiceActions.some(p=>p.action==='VERIFY_ENGINE_ATTRIBUTION'||p.action==='RESTART_ENGINE')) {
            this.pendVoiceAction('RESTART_ENGINE','PENDING_ATTRIBUTION_AND_CONTAINMENT','Prior acquired child exists; direct close does not prove descendant release or endpoint attribution',{pid:this.engine?.receipt.pid,direct:this.engine?.receipt.direct??'NOT_ATTRIBUTED',descendants:this.engine?.receipt.descendants??'UNVERIFIED'});
            return false;
        }
        console.log('[VoiceMonitor] 🔄 Attempting to restart voice engine...');
        sqliteService.log('INFO', 'Voice engine restart initiated', 'voice_monitor');

        // Step 1: Try wake endpoint (if engine is sleeping)
        try {
            const woke=await this.http(`${this.voiceEngineUrl}/wake`,'POST',async response=>response.ok);
            this.operations.signal.throwIfAborted();
            if (woke) {
                this.pendVoiceAction('VERIFY_ENGINE_ATTRIBUTION','PENDING_ATTRIBUTION_AND_CONTAINMENT','Wake endpoint acknowledged; owned engine identity and actual repair are not verified',{url:this.voiceEngineUrl,method:'wake'});
                console.log('[VoiceMonitor] Wake endpoint acknowledged; repair remains pending attribution');
                return false;
            }
        } catch (e) {
            if(this.operations.signal.aborted)throw e;

            this.operations.recordDiagnostic('restartVoiceEngineOnce',e,'DEGRADED_FALLBACK','UNVERIFIED');

            if(this.operations.signal.aborted)throw e;
            this.operations.recordDiagnostic('voice-wake',e,'UNCLASSIFIED','UNVERIFIED');
            // Wake failed, try spawning new process
            console.log('[VoiceMonitor] Wake endpoint failed, attempting process spawn...');
        }

        // Step 2: Try spawning new Python process

        try {
            this.operations.assertAccepting();
            const { spawn } = await import('child_process');
            const path = await import('path');

            const voiceEnginePath = path.join(process.cwd(), 'voice_engine');
            const isWindows = process.platform === 'win32';

            // Build command based on platform
            let cmd: string;
            let args: string[];

            if (isWindows) {
                const fs = await import('fs');
                const os = await import('os');

                // Check for conda env via CONDA_PREFIX or well-known paths
                const condaPrefix = process.env.CONDA_PREFIX;
                const userHome = os.homedir();
                const condaCandidates = [
                    condaPrefix ? path.join(condaPrefix, '..', 'silhouette-tts') : '',
                    path.join(userHome, 'miniconda3', 'envs', 'silhouette-tts'),
                    path.join(userHome, 'anaconda3', 'envs', 'silhouette-tts'),
                ].filter(Boolean);

                let condaEnvPath = '';
                for (const candidate of condaCandidates) {
                    if (candidate && fs.existsSync(path.join(candidate, 'Scripts', 'activate.bat'))) {
                        condaEnvPath = candidate;
                        break;
                    }
                }

                if (condaEnvPath) {
                    cmd = 'cmd.exe';
                    args = ['/c', `call "${condaEnvPath}\\Scripts\\activate.bat" && cd /d "${voiceEnginePath}" && python -m uvicorn main:app --host 0.0.0.0 --port 8100`];
                } else {
                    // Fallback to local venv
                    cmd = 'cmd.exe';
                    args = ['/c', `cd /d "${voiceEnginePath}" && venv\\Scripts\\activate && python -m uvicorn main:app --host 0.0.0.0 --port 8100`];
                }
            } else {
                // Linux/macOS: try venv first, fallback to system python
                const fs = await import('fs');
                const venvActivate = path.join(voiceEnginePath, 'venv', 'bin', 'activate');

                if (fs.existsSync(venvActivate)) {
                    cmd = '/bin/bash';
                    args = ['-c', `cd "${voiceEnginePath}" && source venv/bin/activate && python -m uvicorn main:app --host 0.0.0.0 --port 8100`];
                } else {
                    cmd = '/bin/bash';
                    args = ['-c', `cd "${voiceEnginePath}" && python3 -m uvicorn main:app --host 0.0.0.0 --port 8100`];
                }
            }

            console.log(`[VoiceMonitor] Spawning voice engine: ${cmd} ${args.join(' ')}`);

            this.operations.assertAccepting();
            const child = spawn(cmd, args, {
                cwd: voiceEnginePath,
                detached: false,
                stdio: 'ignore',
                shell: isWindows
            });

            this.engine=ownChild(this.operations,child,'voice-engine-process',this.children);

            // Wait 8 seconds for engine to start
            await this.wait(8000);

            // Verify it's running
            const health = await this.checkHealth();
            if (health.status === 'ONLINE') {
                console.log('[VoiceMonitor] Voice endpoint ONLINE after spawn; child-to-endpoint attribution is unverified');
                this.operations.recordDiagnostic('voice-engine-attribution',new Error('Health endpoint is ONLINE; direct child identity/descendants unverified'),'UNCLASSIFIED','UNVERIFIED');
                this.pendVoiceAction('VERIFY_ENGINE_ATTRIBUTION','PENDING_ATTRIBUTION_AND_CONTAINMENT','Endpoint ONLINE after spawn is not evidence of owned child identity or successful repair',{pid:this.engine?.receipt.pid,url:this.voiceEngineUrl,method:'spawn'});
                return false;
            } else {
                console.warn('[VoiceMonitor] Process spawned but health check failed');
            }

        } catch (e: any) {
            if(this.operations.signal.aborted)throw e;

            this.operations.recordDiagnostic('restartVoiceEngineOnce',e,'DEGRADED_FALLBACK','UNVERIFIED');

            console.error('[VoiceMonitor] ❌ Process spawn failed:', e.message);
            sqliteService.log('ERROR', `Voice engine restart failed: ${e.message}`, 'voice_monitor');
        }

        return false;
    
        });
    }

    // ==================================================
    // TIER 2: DIAGNOSTIC METHODS
    // ==================================================

    /**
     * Gather comprehensive diagnostics for deep analysis
     */
    async gatherDiagnostics(): Promise<VoiceDiagnostics> {
        return this.operations.run('gatherDiagnostics',async()=>{

        console.log('[VoiceMonitor] 🔍 Gathering diagnostics...');

        const [logs, portConflict, pythonEnv, cudaStatus] = await Promise.all([
            this.readVoiceEngineLogs(),
            this.checkPortConflict(),
            this.checkPythonEnvironment(),
            this.checkCudaStatus()
        ]);

        const diagnostics: VoiceDiagnostics = {
            timestamp: Date.now(),
            logs,
            portConflict,
            pythonAvailable: pythonEnv.available,
            pythonVersion: pythonEnv.version,
            cudaAvailable: cudaStatus.available,
            cudaError: cudaStatus.error,
            consecutiveFailures: this.consecutiveFailures,
            lastError: this.stats.lastError
        };

        console.log('[VoiceMonitor] 📋 Diagnostics gathered:', {
            portConflict: diagnostics.portConflict,
            pythonAvailable: diagnostics.pythonAvailable,
            cudaAvailable: diagnostics.cudaAvailable,
            logsLength: diagnostics.logs?.length || 0
        });

        return diagnostics;
    
        });
    }

    /**
     * Read recent voice engine logs
     */
    private async readVoiceEngineLogs(): Promise<string> {
        return this.operations.run('readVoiceEngineLogs',async()=>{

        try {
            const fs = await import('fs/promises');
            const path = await import('path');

            // Try to read Python log file if exists
            const logPath = path.join(process.cwd(), 'voice_engine', 'voice_engine.log');

            try {
                const content = await fs.readFile(logPath, 'utf-8');
                // Return last 50 lines
                const lines = content.split('\n');
                return lines.slice(-50).join('\n');
            } catch(caughtError) {
            this.operations.recordDiagnostic('readVoiceEngineLogs',caughtError,'DEGRADED_FALLBACK','UNVERIFIED');
            if(this.operations.signal.aborted)throw caughtError;

                // Log file doesn't exist, check system logs
                return 'No log file found at voice_engine/voice_engine.log';
            }
        } catch (e: any) {
            if(this.operations.signal.aborted)throw e;

            this.operations.recordDiagnostic('readVoiceEngineLogs',e,'DEGRADED_FALLBACK','UNVERIFIED');

            return `Error reading logs: ${e.message}`;
        }
    
        });
    }

    /**
     * Check if port 8100 is in use by another process
     */
    private async checkPortConflict(): Promise<boolean> {
        return this.operations.run('checkPortConflict',async()=>{

        try {


            const isWindows = process.platform === 'win32';
            const cmd = isWindows
                ? 'netstat -ano | findstr :8100'
                : 'lsof -i :8100';

            const { stdout } = await this.execute(cmd);

            // If we get output, port is in use
            return stdout.trim().length > 0;
        } catch(caughtError) {
            this.operations.recordDiagnostic('checkPortConflict',caughtError,'DEGRADED_FALLBACK','UNVERIFIED');
            if(this.operations.signal.aborted)throw caughtError;

            // Command failed = port not in use (or command not available)
            return false;
        }
    
        });
    }

    /**
     * Check Python environment availability
     */
    private async checkPythonEnvironment(): Promise<{ available: boolean; version?: string }> {
        return this.operations.run('checkPythonEnvironment',async()=>{

        try {


            // Use conda environment Python, not system Python
            const condaPython = 'C:\\Users\\usuario\\miniconda3\\envs\\silhouette-tts\\python.exe';
            const { stdout } = await this.execute(`"${condaPython}" --version`);
            return {
                available: true,
                version: stdout.trim()
            };
        } catch(caughtError) {
            this.operations.recordDiagnostic('checkPythonEnvironment',caughtError,'DEGRADED_FALLBACK','UNVERIFIED');
            if(this.operations.signal.aborted)throw caughtError;

            try {
                // Fallback to system python


                const { stdout } = await this.execute('python --version');
                return {
                    available: true,
                    version: stdout.trim() + ' (system - not conda)'
                };
            } catch(caughtError) {
            this.operations.recordDiagnostic('checkPythonEnvironment',caughtError,'DEGRADED_FALLBACK','UNVERIFIED');
            if(this.operations.signal.aborted)throw caughtError;

                return { available: false };
            }
        }
    
        });
    }

    /**
     * Check CUDA/GPU availability
     */
    private async checkCudaStatus(): Promise<{ available: boolean; error?: string }> {
        return this.operations.run('checkCudaStatus',async()=>{

        try {


            // Use nvidia-smi to check GPU
            const { stdout, stderr } = await this.execute('nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader');

            if (stderr && stderr.includes('NVIDIA-SMI has failed')) {
                return { available: false, error: stderr };
            }

            return {
                available: true
            };
        } catch (e: any) {
            if(this.operations.signal.aborted)throw e;

            this.operations.recordDiagnostic('checkCudaStatus',e,'DEGRADED_FALLBACK','UNVERIFIED');

            return {
                available: false,
                error: e.message
            };
        }
    
        });
    }

    /**
     * Kill process occupying port 8100
     */
    async killPortProcess():Promise<boolean> {
        return this.operations.run('killPortProcess',async()=>{
            this.pendVoiceAction('STOP_OWNED_ENGINE','PENDING_ATTRIBUTION_AND_CONTAINMENT','Port occupancy is not process identity; stop requires an unequivocally owned child and scoped authority',{requestedPort:8100,ownedChildPid:this.engine?.receipt.pid,policy:'No lsof/netstat-selected PID or arbitrary port kill'});
            return false;
        });
    }

    /**
     * Install missing Python dependencies
     */
    async installDependencies():Promise<boolean> {
        return this.operations.run('installDependencies',async()=>{
            const path=await import('path');
            const voiceEnginePath=path.join(process.cwd(),'voice_engine');
            const condaEnvPath='C:\\Users\\usuario\\miniconda3\\envs\\silhouette-tts';
            this.pendVoiceAction('INSTALL_DEPENDENCIES','PENDING_AUTHORIZATION','Dependency installation requires specific authenticated authorization; technical task or incident is not approval',{
                executable:path.join(condaEnvPath,'Scripts','pip.exe'),args:['install','-r',path.join(voiceEnginePath,'requirements.txt')],cwd:voiceEnginePath,timeout:300000,
                execution:'NOT_STARTED',authorization:'NOT_ESTABLISHED'
            });
            return false;
        });
    }

    /**
     * Set CPU-only mode for voice engine (disable CUDA)
     */
    async setCpuOnlyMode(): Promise<void> {
        return this.operations.run('setCpuOnlyMode',async()=>{

        process.env.CUDA_VISIBLE_DEVICES = '';
        console.log('[VoiceMonitor] 🔧 Set CUDA_VISIBLE_DEVICES="" for CPU-only mode');
        sqliteService.log('INFO', 'Voice engine set to CPU-only mode', 'voice_monitor');
    
        });
    }
}

// Diagnostic result interface
export interface VoiceDiagnostics {
    timestamp: number;
    logs: string;
    portConflict: boolean;
    pythonAvailable: boolean;
    pythonVersion?: string;
    cudaAvailable: boolean;
    cudaError?: string;
    consecutiveFailures: number;
    lastError?: string;
}

export const voiceMonitor = new VoiceMonitorService();


