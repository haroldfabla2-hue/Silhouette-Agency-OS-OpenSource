const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let serverProcess;

function startServer() {
    console.log('[Electron] Starting Silhouette OS Core Server...');
    const isDev = !app.isPackaged;
    
    if (isDev) {
        // Dev Mode: Launch the dev script
        serverProcess = spawn('npm.cmd', ['run', 'server'], {
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

    // A brief delay to let the Node express server bind port 3005
    setTimeout(() => {
        mainWindow.loadURL('http://localhost:3005').catch(err => {
            console.error('[Electron] Failed to load UI URL, retrying...', err);
            mainWindow.loadURL('http://localhost:3005');
        });
    }, 4000);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.on('ready', () => {
    startServer();
    createWindow();
});

app.on('window-all-closed', () => {
    console.log('[Electron] Shutting down subprocesses...');
    if (serverProcess) {
        serverProcess.kill('SIGINT');
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
