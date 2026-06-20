const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onOnboardingProgress: (callback) => {
        const subscription = (event, value) => callback(value);
        ipcRenderer.on('onboarding-progress', subscription);
        return () => {
            ipcRenderer.removeListener('onboarding-progress', subscription);
        };
    },
    setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled)
});
