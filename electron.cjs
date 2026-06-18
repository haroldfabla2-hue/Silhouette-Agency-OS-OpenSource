const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let serverProcess;
let brainApiProcess;
let brainDaemonProcess;

const isDev = !app.isPackaged;

function getPythonExecutable(brainPath) {
    const isWin = process.platform === 'win32';
    const venvPath = isWin
        ? path.join(brainPath, 'venv', 'Scripts', 'python.exe')
        : path.join(brainPath, 'venv', 'bin', 'python');

    if (fs.existsSync(venvPath)) {
        console.log(`[Electron] Found virtual environment python: ${venvPath}`);
        return venvPath;
    }
    
    console.log(`[Electron] Virtual env not found. Falling back to system python.`);
    return isWin ? 'python' : 'python3';
}

function startServer() {
    console.log('[Electron] Starting Silhouette OS Core Server...');
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    
    if (isDev) {
        // Dev Mode: Launch the dev script
        serverProcess = spawn(npmCmd, ['run', 'server'], {
            shell: true,
            env: { ...process.env, PORT: '3005' }
        });
    } else {
        // Packaged Production Mode: Run compiled bundle
        const serverPath = path.join(__dirname, 'dist', 'server', 'index.js');
        serverProcess = spawn('node', [serverPath], {
            env: { ...process.env, PORT: '3005', NODE_ENV: 'production' }
        });
    }

    serverProcess.stdout.on('data', (data) => {
        console.log(`[Server] ${data.toString().trim()}`);
    });

    serverProcess.stderr.on('data', (data) => {
        console.error(`[Server ERROR] ${data.toString().trim()}`);
    });
}

function startEcosystem() {
    // Detect sibling silhouette-brain directory
    const potentialPaths = [
        path.resolve(process.cwd(), '../silhouette-brain'),
        path.resolve(__dirname, '../silhouette-brain')
    ];
    
    let brainPath = null;
    for (const p of potentialPaths) {
        if (fs.existsSync(p)) {
            brainPath = p;
            break;
        }
    }

    if (!brainPath) {
        console.log('[Electron] Sibling silhouette-brain directory not detected. Silhouette Brain will not be auto-started.');
        return;
    }

    console.log(`[Electron] Detected Silhouette Brain at: ${brainPath}`);
    const pythonExe = getPythonExecutable(brainPath);

    // Build platform-compatible PYTHONPATH and environmental variables
    const pathSeparator = process.platform === 'win32' ? ';' : ':';
    const pythonPath = [
        path.join(brainPath, 'src', 'core'),
        path.join(brainPath, 'src', 'api'),
        brainPath
    ].join(pathSeparator);

    const brainEnv = {
        ...process.env,
        PYTHONPATH: pythonPath,
        BRAIN_ROOT: brainPath,
        BRAIN_SRC_DIR: path.join(brainPath, 'src', 'core'),
        BRAIN_DATA_DIR: path.join(brainPath, 'data'),
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
    };

    // 1. Start Enhanced Memory API
    const apiScript = path.join(brainPath, 'src', 'api', 'enhanced_memory_api.py');
    if (fs.existsSync(apiScript)) {
        console.log(`[Electron] Spawning Brain API: ${apiScript}`);
        brainApiProcess = spawn(pythonExe, [apiScript], {
            cwd: brainPath,
            env: brainEnv
        });

        brainApiProcess.stdout.on('data', (data) => {
            console.log(`[Brain API] ${data.toString().trim()}`);
        });

        brainApiProcess.stderr.on('data', (data) => {
            console.error(`[Brain API ERROR] ${data.toString().trim()}`);
        });
    } else {
        console.error(`[Electron] Brain API script not found at: ${apiScript}`);
    }

    // 2. Start Unified Daemon
    const daemonScript = path.join(brainPath, 'src', 'core', 'unified_daemon.py');
    if (fs.existsSync(daemonScript)) {
        console.log(`[Electron] Spawning Brain Daemon: ${daemonScript}`);
        brainDaemonProcess = spawn(pythonExe, [daemonScript], {
            cwd: brainPath,
            env: brainEnv
        });

        brainDaemonProcess.stdout.on('data', (data) => {
            console.log(`[Brain Daemon] ${data.toString().trim()}`);
        });

        brainDaemonProcess.stderr.on('data', (data) => {
            console.error(`[Brain Daemon ERROR] ${data.toString().trim()}`);
        });
    } else {
        console.error(`[Electron] Brain Daemon script not found at: ${daemonScript}`);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1366,
        height: 768,
        title: "Silhouette Agency OS",
        backgroundColor: "#0A0A0A",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    // Load the diagnostics splash screen
    const splashPath = isDev 
        ? path.join(__dirname, 'public', 'splash.html')
        : path.join(__dirname, 'dist', 'splash.html');

    mainWindow.loadFile(splashPath).catch(err => {
        console.error('[Electron] Failed to load splash screen file', err);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function killProcess(proc, name) {
    if (!proc) return;
    console.log(`[Electron] Terminating ${name} (PID: ${proc.pid})...`);
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', proc.pid, '/f', '/t'], { stdio: 'ignore' });
        } else {
            proc.kill('SIGINT');
        }
    } catch (err) {
        console.error(`[Electron] Failed to terminate ${name}:`, err);
    }
}

app.on('ready', () => {
    startServer();
    startEcosystem();
    createWindow();
});

app.on('window-all-closed', () => {
    console.log('[Electron] Shutting down subprocesses...');
    killProcess(serverProcess, 'Node Core Server');
    killProcess(brainApiProcess, 'Brain API');
    killProcess(brainDaemonProcess, 'Brain Daemon');
    
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

