const { contextBridge, ipcRenderer } = require('electron');

// Whitelist of channels security
const validSendChannels = [
    'dialog:openDirectory',
    'fs:readDirectoryStructure',
    'fs:readFileContent',
    'project:export'
    // Removed git, settings, system info, etc. channels
];
const validReceiveChannels = [
    'trigger-open-folder', // For menu actions
    'trigger-export-project', // For menu actions
    'show-error' // For backend errors
];

contextBridge.exposeInMainWorld('electronAPI', {
    // Use invoke for request/response (Main handles request)
    invoke: (channel, ...args) => {
        if (validSendChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args);
        }
        console.error(`Invalid invoke channel attempted: ${channel}`);
        return Promise.reject(new Error(`Invalid IPC channel: ${channel}`));
    },
    // Use 'on' for messages from Main to Renderer
    on: (channel, func) => {
        if (validReceiveChannels.includes(channel)) {
            const subscription = (event, ...args) => func(...args);
            ipcRenderer.on(channel, subscription);
            // Return a cleanup function
            return () => ipcRenderer.removeListener(channel, subscription);
        }
        console.error(`Invalid listener channel attempted: ${channel}`);
        return () => {}; // No-op cleanup
    },
});

console.log('Preload script executed.');