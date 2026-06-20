const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const log = require('electron-log');
const { pythonBackendManager } = require('./pythonManager.cjs');

// Configure structured logging
log.transports.file.level = 'info';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
log.transports.console.level = 'debug';

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
            sandbox: true,
            preload: path.join(__dirname, 'preload.cjs')
        }
    });

    // Load the diagnostics splash screen
    const splashPath = isDev 
        ? path.join(__dirname, 'public', 'splash.html')
        : path.join(process.resourcesPath, 'splash.html');

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

ipcMain.handle('set-auto-launch', async (event, enabled) => {
    try {
        app.setLoginItemSettings({
            openAtLogin: enabled,
            path: process.execPath
        });
        log.info(`[Electron] Auto-launch updated via IPC: ${enabled}`);
        return { success: true };
    } catch (err) {
        log.error('[Electron] Failed to update auto-launch via IPC:', err.message);
        return { success: false, error: err.message };
    }
});

app.on('ready', async () => {
    log.info('[Electron] Silhouette Agency OS starting...');
    log.info(`[Electron] Version: ${app.getVersion()}, Packaged: ${app.isPackaged}`);
    log.info(`[Electron] Platform: ${process.platform}, Arch: ${process.arch}`);
    
    // Read local configuration silhouette.config.json if it exists
    let config = {};
    const configPath = path.join(process.cwd(), 'silhouette.config.json');
    if (fs.existsSync(configPath)) {
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch (e) {
            log.error('[Electron] Failed to read silhouette.config.json:', e.message);
        }
    }

    // Apply auto-launch configuration on boot
    const autoLaunchEnabled = config.system?.autoLaunch ?? false;
    try {
        app.setLoginItemSettings({
            openAtLogin: autoLaunchEnabled,
            path: process.execPath
        });
        log.info(`[Electron] Auto-Launch set to: ${autoLaunchEnabled}`);
    } catch (err) {
        log.warn('[Electron] Failed to set auto-launch on boot:', err.message);
    }
    
    startServer();
    createWindow();
    pythonBackendManager.initialize(mainWindow);

    // Auto-updater (production only)
    if (app.isPackaged) {
        try {
            const { autoUpdater } = require('electron-updater');
            autoUpdater.logger = log;
            autoUpdater.autoDownload = false;
            
            autoUpdater.on('update-available', (info) => {
                log.info(`[AutoUpdate] Update available: v${info.version}`);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-available', info.version);
                }
            });

            autoUpdater.on('update-downloaded', (info) => {
                log.info(`[AutoUpdate] Update downloaded: v${info.version}`);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-downloaded', info.version);
                }
            });

            autoUpdater.on('error', (err) => {
                log.error('[AutoUpdate] Error checking for updates:', err.message);
            });

            // Check for updates after 10 seconds (only if enabled)
            const autoCheckUpdates = config.system?.autoCheckUpdates ?? true;
            if (autoCheckUpdates) {
                setTimeout(() => autoUpdater.checkForUpdates(), 10000);
            } else {
                log.info('[AutoUpdate] Auto-check updates is disabled.');
            }
        } catch (err) {
            log.warn('[AutoUpdate] electron-updater not available:', err.message);
        }
    }
});

app.on('window-all-closed', () => {
    console.log('[Electron] Shutting down subprocesses...');
    killProcess(serverProcess, 'Node Core Server');
    pythonBackendManager.shutdown();
    
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

