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

class VoiceMonitorService {
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
        if (this.healthCheckInterval) {
            console.log('[VoiceMonitor] Already running');
            return;
        }

        console.log('[VoiceMonitor] Starting health monitoring...');
        this.healthCheckInterval = setInterval(() => this.checkHealth(), this.checkIntervalMs);

        // Initial check
        this.checkHealth();
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
        try {
            const startTime = Date.now();
            const response = await fetch(`${this.voiceEngineUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000) // 5 second timeout
            });

            const latency = Date.now() - startTime;
            const data = await response.json() as VoiceEngineHealth;
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
    }

    /**
     * Request self-repair via systemBus
     */
    private async requestSelfRepair(): Promise<void> {
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
    }

    /**
     * Record a TTS request for statistics
     */
    recordTTSRequest(success: boolean, latencyMs: number, error?: string): void {
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
    async restartVoiceEngine(): Promise<boolean> {
        console.log('[VoiceMonitor] 🔄 Attempting to restart voice engine...');
        sqliteService.log('INFO', 'Voice engine restart initiated', 'voice_monitor');

        // Step 1: Try wake endpoint (if engine is sleeping)
        try {
            const wakeResponse = await fetch(`${this.voiceEngineUrl}/wake`, {
                method: 'POST',
                signal: AbortSignal.timeout(5000)
            });
            if (wakeResponse.ok) {
                console.log('[VoiceMonitor] ✅ Voice engine woke up via /wake endpoint');
                this.lastHealthStatus = 'ONLINE';
                systemBus.emit(SystemProtocol.VOICE_ENGINE_ONLINE, {
                    timestamp: Date.now(),
                    restartedAutomatically: true,
                    method: 'wake'
                }, 'voice_monitor');
                return true;
            }
        } catch (e) {
            // Wake failed, try spawning new process
            console.log('[VoiceMonitor] Wake endpoint failed, attempting process spawn...');
        }

        // Step 2: Try spawning new Python process
        try {
            const { spawn } = await import('child_process');
            const path = await import('path');

            const voiceEnginePath = path.join(process.cwd(), 'voice_engine');
            const isWindows = process.platform === 'win32';

            // Build command based on platform
            let cmd: string;
            let args: string[];

            if (isWindows) {
                // Try conda first, fallback to venv
                const condaPath = 'C:\\Users\\usuario\\miniconda3\\condabin\\activate.bat';
                const fs = await import('fs');

                if (fs.existsSync(condaPath)) {
                    // Use conda - call Scripts\activate.bat directly with env path
                    const condaEnvPath = 'C:\\Users\\usuario\\miniconda3\\envs\\silhouette-tts';
                    cmd = 'cmd.exe';
                    args = ['/c', `call "${condaEnvPath}\\Scripts\\activate.bat" && cd /d "${voiceEnginePath}" && python -m uvicorn main:app --host 0.0.0.0 --port 8100`];
                } else {
                    // Use local venv
                    cmd = 'cmd.exe';
                    args = ['/c', `cd /d "${voiceEnginePath}" && venv\\Scripts\\activate && python -m uvicorn main:app --host 0.0.0.0 --port 8100`];
                }
            } else {
                cmd = '/bin/bash';
                args = ['-c', `cd "${voiceEnginePath}" && source venv/bin/activate && python -m uvicorn main:app --host 0.0.0.0 --port 8100`];
            }

            console.log(`[VoiceMonitor] Spawning voice engine: ${cmd} ${args.join(' ')}`);

            const child = spawn(cmd, args, {
                cwd: voiceEnginePath,
                detached: true,
                stdio: 'ignore',
                shell: isWindows
            });

            child.unref();

            // Wait 8 seconds for engine to start
            await new Promise(r => setTimeout(r, 8000));

            // Verify it's running
            const health = await this.checkHealth();
            if (health.status === 'ONLINE') {
                console.log('[VoiceMonitor] ✅ Voice engine restarted successfully via process spawn!');
                sqliteService.log('INFO', 'Voice engine auto-restart SUCCESS', 'voice_monitor');
                systemBus.emit(SystemProtocol.VOICE_ENGINE_ONLINE, {
                    timestamp: Date.now(),
                    restartedAutomatically: true,
                    method: 'spawn'
                }, 'voice_monitor');
                return true;
            } else {
                console.warn('[VoiceMonitor] Process spawned but health check failed');
            }

        } catch (e: any) {
            console.error('[VoiceMonitor] ❌ Process spawn failed:', e.message);
            sqliteService.log('ERROR', `Voice engine restart failed: ${e.message}`, 'voice_monitor');
        }

        return false;
    }

    // ==================================================
    // TIER 2: DIAGNOSTIC METHODS
    // ==================================================

    /**
     * Gather comprehensive diagnostics for deep analysis
     */
    async gatherDiagnostics(): Promise<VoiceDiagnostics> {
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
    }

    /**
     * Read recent voice engine logs
     */
    private async readVoiceEngineLogs(): Promise<string> {
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
            } catch {
                // Log file doesn't exist, check system logs
                return 'No log file found at voice_engine/voice_engine.log';
            }
        } catch (e: any) {
            return `Error reading logs: ${e.message}`;
        }
    }

    /**
     * Check if port 8100 is in use by another process
     */
    private async checkPortConflict(): Promise<boolean> {
        try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            const isWindows = process.platform === 'win32';
            const cmd = isWindows
                ? 'netstat -ano | findstr :8100'
                : 'lsof -i :8100';

            const { stdout } = await execAsync(cmd);

            // If we get output, port is in use
            return stdout.trim().length > 0;
        } catch {
            // Command failed = port not in use (or command not available)
            return false;
        }
    }

    /**
     * Check Python environment availability
     */
    private async checkPythonEnvironment(): Promise<{ available: boolean; version?: string }> {
        try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            // Use conda environment Python, not system Python
            const condaPython = 'C:\\Users\\usuario\\miniconda3\\envs\\silhouette-tts\\python.exe';
            const { stdout } = await execAsync(`"${condaPython}" --version`);
            return {
                available: true,
                version: stdout.trim()
            };
        } catch {
            try {
                // Fallback to system python
                const { exec } = await import('child_process');
                const { promisify } = await import('util');
                const execAsync = promisify(exec);

                const { stdout } = await execAsync('python --version');
                return {
                    available: true,
                    version: stdout.trim() + ' (system - not conda)'
                };
            } catch {
                return { available: false };
            }
        }
    }

    /**
     * Check CUDA/GPU availability
     */
    private async checkCudaStatus(): Promise<{ available: boolean; error?: string }> {
        try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            // Use nvidia-smi to check GPU
            const { stdout, stderr } = await execAsync('nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader');

            if (stderr && stderr.includes('NVIDIA-SMI has failed')) {
                return { available: false, error: stderr };
            }

            return {
                available: true
            };
        } catch (e: any) {
            return {
                available: false,
                error: e.message
            };
        }
    }

    /**
     * Kill process occupying port 8100
     */
    async killPortProcess(): Promise<boolean> {
        try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            const isWindows = process.platform === 'win32';

            if (isWindows) {
                // Find PID using port
                const { stdout } = await execAsync('netstat -ano | findstr :8100 | findstr LISTENING');
                const lines = stdout.trim().split('\n');

                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && pid !== '0') {
                        await execAsync(`taskkill /F /PID ${pid}`);
                        console.log(`[VoiceMonitor] Killed process ${pid} on port 8100`);
                    }
                }
            } else {
                await execAsync('kill $(lsof -t -i:8100)');
            }

            sqliteService.log('INFO', 'Killed conflicting process on port 8100', 'voice_monitor');
            return true;
        } catch (e: any) {
            console.warn('[VoiceMonitor] Failed to kill port process:', e.message);
            return false;
        }
    }

    /**
     * Install missing Python dependencies
     */
    async installDependencies(): Promise<boolean> {
        try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);
            const path = await import('path');

            const voiceEnginePath = path.join(process.cwd(), 'voice_engine');
            const reqPath = path.join(voiceEnginePath, 'requirements.txt');

            // Use conda environment pip, not system pip
            const condaEnvPath = 'C:\\Users\\usuario\\miniconda3\\envs\\silhouette-tts';
            const condaPip = path.join(condaEnvPath, 'Scripts', 'pip.exe');

            console.log('[VoiceMonitor] 📦 Installing Python dependencies in conda env...');

            await execAsync(`"${condaPip}" install -r "${reqPath}"`, {
                cwd: voiceEnginePath,
                timeout: 300000 // 5 minutes
            });

            sqliteService.log('INFO', 'Python dependencies installed successfully', 'voice_monitor');
            return true;
        } catch (e: any) {
            console.error('[VoiceMonitor] Failed to install dependencies:', e.message);
            sqliteService.log('ERROR', `Dependency install failed: ${e.message}`, 'voice_monitor');
            return false;
        }
    }

    /**
     * Set CPU-only mode for voice engine (disable CUDA)
     */
    async setCpuOnlyMode(): Promise<void> {
        process.env.CUDA_VISIBLE_DEVICES = '';
        console.log('[VoiceMonitor] 🔧 Set CUDA_VISIBLE_DEVICES="" for CPU-only mode');
        sqliteService.log('INFO', 'Voice engine set to CPU-only mode', 'voice_monitor');
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


