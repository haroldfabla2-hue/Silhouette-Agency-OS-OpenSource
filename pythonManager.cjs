const { app } = require('electron');
const path = require('path');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

class PythonBackendManager {
    constructor() {
        this.userDataPath = app.getPath('userData');
        this.venvPath = path.join(this.userDataPath, 'silhouette_brain_venv');
        this.isDev = !app.isPackaged;
        this.brainPath = this.detectBrainPath();
        
        // Process references
        this.apiProcess = null;
        this.daemonProcess = null;
    }

    privateLog(msg) {
        console.log(`[PythonManager] ${msg}`);
    }

    notifyWindow(win, message, percent = 0) {
        if (win && !win.isDestroyed()) {
            win.webContents.send('onboarding-progress', { message, percent });
        }
    }

    detectBrainPath() {
        const potentialPaths = [
            path.resolve(process.cwd(), '../silhouette-brain'),
            path.resolve(__dirname, '../silhouette-brain'),
            path.join(process.resourcesPath, 'silhouette-brain')
        ];
        
        for (const p of potentialPaths) {
            if (fs.existsSync(p)) {
                this.privateLog(`Detected Silhouette Brain source at: ${p}`);
                return p;
            }
        }
        return null;
    }

    getBasePythonExe() {
        const isWin = process.platform === 'win32';
        const pyName = isWin ? 'python.exe' : 'bin/python3';
        const portablePath = path.join(process.resourcesPath, 'python', pyName);

        if (fs.existsSync(portablePath)) {
            this.privateLog(`Using portable base Python interpreter: ${portablePath}`);
            return portablePath;
        }

        // Fallback to system Python for development environment
        this.privateLog(`Portable Python not found. Falling back to system Python.`);
        return isWin ? 'python' : 'python3';
    }

    getVenvPythonExe() {
        const isWin = process.platform === 'win32';
        const pyName = isWin ? 'Scripts\\python.exe' : 'bin/python';
        return path.join(this.venvPath, pyName);
    }

    async initialize(win) {
        if (!this.brainPath) {
            this.privateLog('⚠️ Sibling silhouette-brain directory not detected. Skipping Python API execution.');
            this.notifyWindow(win, 'Intelligent Brain not found. Running in core mode only.', 100);
            return;
        }

        const venvPython = this.getVenvPythonExe();
        const basePython = this.getBasePythonExe();

        // Check if writable Virtual Environment already exists
        if (!fs.existsSync(venvPython)) {
            this.privateLog('Creating writable Python Virtual Environment...');
            this.notifyWindow(win, 'Iniciando primer arranque: Creando entorno aislado virtual...', 15);
            
            try {
                // 1. Create venv: basePython -m venv venvPath
                await execFileAsync(basePython, ['-m', 'venv', this.venvPath]);
                this.privateLog(`Venv created successfully at: ${this.venvPath}`);
                
                // 2. Install requirements: venvPython -m pip install -r requirements.txt
                this.notifyWindow(win, 'Instalando dependencias de Inteligencia Artificial (pip)...', 40);
                await this.installDependencies(win);
                
                this.notifyWindow(win, 'Entorno virtual configurado con éxito.', 90);
            } catch (err) {
                this.privateLog(`❌ Error initializing Python venv: ${err.message}`);
                this.notifyWindow(win, `Error al crear venv: ${err.message}. Intentando iniciar con Python del sistema.`, 90);
            }
        } else {
            this.privateLog('Writable Virtual Environment already initialized.');
        }

        // 3. Start Python servers using the venv python
        this.notifyWindow(win, 'Levantando procesos de la Colmena de Agentes...', 95);
        this.startEcosystem();
        this.notifyWindow(win, 'Todos los procesos iniciados con éxito.', 100);
    }

    async installDependencies(win) {
        const venvPython = this.getVenvPythonExe();
        const requirementsPath = path.join(this.brainPath, 'requirements.txt');

        if (!fs.existsSync(requirementsPath)) {
            this.privateLog(`requirements.txt not found at: ${requirementsPath}. Skipping pip install.`);
            return;
        }

        this.privateLog(`Installing requirements from: ${requirementsPath}`);

        return new Promise((resolve, reject) => {
            // First upgrade pip
            execFile(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], (err) => {
                if (err) this.privateLog(`Warning: Failed to upgrade pip: ${err.message}`);

                // Then run pip install requirements
                const pipProcess = spawn(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath]);
                
                let progressPercent = 40;
                pipProcess.stdout.on('data', (data) => {
                    const output = data.toString().trim();
                    if (output) {
                        this.privateLog(`[pip] ${output.substring(0, 100)}`);
                        // Mock progress update increment
                        progressPercent = Math.min(85, progressPercent + 0.5);
                        this.notifyWindow(win, `Instalando dependencias: ${output.substring(0, 50)}...`, progressPercent);
                    }
                });

                pipProcess.stderr.on('data', (data) => {
                    this.privateLog(`[pip warning] ${data.toString().trim()}`);
                });

                pipProcess.on('close', (code) => {
                    if (code === 0) {
                        this.privateLog('Pip install requirements completed successfully.');
                        resolve();
                    } else {
                        reject(new Error(`pip install exited with code ${code}`));
                    }
                });
            });
        });
    }

    startEcosystem() {
        const pythonExe = fs.existsSync(this.getVenvPythonExe()) ? this.getVenvPythonExe() : this.getBasePythonExe();
        this.privateLog(`Spawning Python ecosystem using: ${pythonExe}`);

        const pathSeparator = process.platform === 'win32' ? ';' : ':';
        const pythonPath = [
            path.join(this.brainPath, 'src', 'core'),
            path.join(this.brainPath, 'src', 'api'),
            this.brainPath
        ].join(pathSeparator);

        const brainEnv = {
            ...process.env,
            PYTHONPATH: pythonPath,
            BRAIN_ROOT: this.brainPath,
            BRAIN_SRC_DIR: path.join(this.brainPath, 'src', 'core'),
            BRAIN_DATA_DIR: path.join(this.brainPath, 'data'),
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8'
        };

        // 1. Start Enhanced Memory API
        const apiScript = path.join(this.brainPath, 'src', 'api', 'enhanced_memory_api.py');
        if (fs.existsSync(apiScript)) {
            this.privateLog(`Spawning Brain API: ${apiScript}`);
            this.apiProcess = spawn(pythonExe, [apiScript], {
                cwd: this.brainPath,
                env: brainEnv
            });

            this.apiProcess.stdout.on('data', (data) => {
                console.log(`[Brain API] ${data.toString().trim()}`);
            });

            this.apiProcess.stderr.on('data', (data) => {
                console.error(`[Brain API ERROR] ${data.toString().trim()}`);
            });
        }

        // 2. Start Unified Daemon
        const daemonScript = path.join(this.brainPath, 'src', 'core', 'unified_daemon.py');
        if (fs.existsSync(daemonScript)) {
            this.privateLog(`Spawning Brain Daemon: ${daemonScript}`);
            this.daemonProcess = spawn(pythonExe, [daemonScript], {
                cwd: this.brainPath,
                env: brainEnv
            });

            this.daemonProcess.stdout.on('data', (data) => {
                console.log(`[Brain Daemon] ${data.toString().trim()}`);
            });

            this.daemonProcess.stderr.on('data', (data) => {
                console.error(`[Brain Daemon ERROR] ${data.toString().trim()}`);
            });
        }
    }

    killProcess(proc, name) {
        if (!proc) return;
        this.privateLog(`Terminating ${name} (PID: ${proc.pid})...`);
        try {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', proc.pid, '/f', '/t'], { stdio: 'ignore' });
            } else {
                proc.kill('SIGINT');
            }
        } catch (err) {
            console.error(`❌ Failed to terminate ${name}:`, err);
        }
    }

    shutdown() {
        this.killProcess(this.apiProcess, 'Brain API');
        this.killProcess(this.daemonProcess, 'Brain Daemon');
        this.apiProcess = null;
        this.daemonProcess = null;
    }
}

module.exports = {
    pythonBackendManager: new PythonBackendManager()
};
