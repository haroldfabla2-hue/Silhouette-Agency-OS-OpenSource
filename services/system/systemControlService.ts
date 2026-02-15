import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import screenshot from 'screenshot-desktop';


import si from 'systeminformation';

const execAsync = promisify(exec);


export interface CommandResult {
    stdout: string;
    stderr: string;
    code: number | null;
}

export class SystemControlService {
    private static instance: SystemControlService;

    // Whitelist of allowed applications (extensible)
    private allowedApps: string[] = [
        'notepad', 'calc', 'mspaint', 'explorer', 'cmd', 'powershell', 'code', 'chrome', 'firefox'
    ];

    // Dangerous commands blacklist (Enhanced Security)
    private dangerousCommands: string[] = [
        // Universal / Linux / Mac
        'rm -rf', 'rm -r', 'rm -f', 'rm /', 'rm *',
        'mkfs', 'dd if=', 'wget', 'curl', '| sh', '| bash',
        ':(){ :|:& };:', // Fork bomb
        'chmod 777', 'chmod -R 777',
        'mv /', '> /dev/sda', '> /dev/hda',

        // Windows
        'format c:', 'format d:', 'format /',
        'del /s', 'del /q', 'del *.*',
        'rd /s', 'rd /q',
        'deltree',
        'shutdown', 'taskkill /f /im svchost.exe'
    ];

    private constructor() { }

    public static getInstance(): SystemControlService {
        if (!SystemControlService.instance) {
            SystemControlService.instance = new SystemControlService();
        }
        return SystemControlService.instance;
    }

    /**
     * Executes a shell command safely.
     * @param command The command to execute
     * @param cwd Optional current working directory
     */
    public async executeCommand(command: string, cwd?: string, background: boolean = false): Promise<CommandResult> {
        console.log(`[SystemControl] Executing: ${command} ${background ? '(Background)' : ''}`);

        if (this.isDangerous(command)) {
            throw new Error(`Command rejected by safety policy: ${command}`);
        }

        if (background) {
            try {
                // Use spawn for background processes
                // Windows needs 'shell: true' or 'cmd /c' for some commands, but for pure background app launching,
                // we often want to detach.
                const child = spawn(command, [], {
                    cwd,
                    shell: true,
                    detached: true,
                    stdio: 'ignore' // Ignore stdio for background
                });

                child.unref(); // Detach from parent

                return {
                    stdout: `Started background process (PID: ${child.pid})`,
                    stderr: '',
                    code: 0
                };
            } catch (error: any) {
                console.error(`[SystemControl] Background execution failed:`, error);
                return {
                    stdout: '',
                    stderr: error.message,
                    code: 1
                };
            }
        }

        try {
            const { stdout, stderr } = await execAsync(command, { cwd });
            return { stdout, stderr, code: 0 };
        } catch (error: any) {
            console.error(`[SystemControl] Execution failed:`, error);
            return {
                stdout: error.stdout || '',
                stderr: error.stderr || error.message,
                code: error.code || 1
            };
        }
    }

    public async openApplication(target: string): Promise<string> {
        console.log(`[SystemControl] Opening: ${target}`);

        // [SECURITY] Sanitization & Validation
        // Prevent command injection via quotes or shell metacharacters if possible
        // Though 'start' command in Windows handles quotes well, we must ensure 'target' isn't malicious.

        // 1. Block dangerous file extensions
        const lowerTarget = target.toLowerCase();
        const dangerousExtensions = ['.bat', '.cmd', '.ps1', '.vbs', '.js', '.sh', '.bash', '.reg', '.jar'];
        if (dangerousExtensions.some(ext => lowerTarget.endsWith(ext))) {
            throw new Error(`Security Policy: Opening executable scripts (${path.extname(target)}) is forbidden via this tool.`);
        }

        let command: string;
        switch (process.platform) {
            case 'darwin':
                command = `open "${target}"`; // Vulnerable if target has " ; rm -rf /"
                break;
            case 'linux':
                command = `xdg-open "${target}"`;
                break;
            case 'win32':
                // Windows 'start' is tricky with quotes. 
                // Format: start "Title" "Target"
                // We use title "" to avoid the target being interpreted as a title.
                command = `start "" "${target}"`;
                break;
            default:
                throw new Error(`Unsupported platform: ${process.platform}`);
        }

        // [SECURITY] Regex check for shell injection characters
        // Block: ; | & $ > < `
        if (/[;&|><$`]/.test(target)) {
            throw new Error("Security Policy: Target contains illegal shell characters.");
        }

        try {
            await execAsync(command);
            return `Successfully launched: ${target}`;
        } catch (error: any) {
            throw new Error(`Failed to launch ${target}: ${error.message}`);
        }
    }

    /**
     * Captures a screenshot of the specified monitor.
     * @param monitorIndex The index of the monitor to capture (default 0)
     * @returns Base64 encoded image string
     */
    public async getScreenshot(monitorIndex: number = 0): Promise<string> {
        try {
            const displays = await screenshot.listDisplays();

            if (displays.length === 0) {
                // Fallback for systems without display info
                const img = await screenshot();
                return img.toString('base64');
            }

            const display = displays[monitorIndex] || displays[0];
            const img = await screenshot({ screen: display.id });
            return img.toString('base64');
        } catch (error: any) {
            console.error(`[SystemControl] Screenshot failed:`, error);
            throw new Error(`Failed to capture screenshot: ${error.message}`);
        }
    }

    public async getSystemInfo(): Promise<any> {
        try {
            const [cpu, mem, osInfo, processes] = await Promise.all([
                si.cpu(),
                si.mem(),
                si.osInfo(),
                si.processes()
            ]);

            return {
                timestamp: Date.now(),
                os: {
                    platform: osInfo.platform,
                    distro: osInfo.distro,
                    release: osInfo.release,
                    arch: osInfo.arch,
                    hostname: osInfo.hostname
                },
                cpu: {
                    load: (await si.currentLoad()).currentLoad.toFixed(2) + '%',
                    cores: cpu.cores,
                    brand: cpu.brand
                },
                memory: {
                    total: (mem.total / 1024 / 1024 / 1024).toFixed(2) + ' GB',
                    free: (mem.free / 1024 / 1024 / 1024).toFixed(2) + ' GB',
                    used: (mem.used / 1024 / 1024 / 1024).toFixed(2) + ' GB',
                    active: (mem.active / 1024 / 1024 / 1024).toFixed(2) + ' GB'
                },
                processes: {
                    total: processes.all,
                    running: processes.running,
                    blocked: processes.blocked
                }
            };
        } catch (error: any) {
            console.error(`[SystemControl] Failed to get system info:`, error);
            throw new Error(`Failed to retrieve system info: ${error.message}`);
        }
    }

    private isDangerous(command: string): boolean {
        const lowerCmd = command.toLowerCase().trim();

        // Check blacklist
        const isBlacklisted = this.dangerousCommands.some(forbidden => lowerCmd.includes(forbidden));
        if (isBlacklisted) return true;

        // Heuristic detection (e.g. piping to shell)
        if ((lowerCmd.includes('wget') || lowerCmd.includes('curl')) && (lowerCmd.includes('| sh') || lowerCmd.includes('| bash'))) {
            return true;
        }

        return false;
    }
}
