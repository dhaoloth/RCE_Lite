const { contextBridge, ipcRenderer } = require('electron');

const validSendChannels = [
    'dialog:openDirectory',
    'fs:readDirectoryStructure',
    'fs:readFileContent',
    'project:export',
    'history:get',
    'history:add',
    'history:clear',
    'dialog:selectHomeDirectory',
    'fs:findRepositories',
    'fs:writeFileContent'
];
const validReceiveChannels = [
    'trigger-open-folder',
    'trigger-export-project',
    'show-error',
    'trigger-scan-home',
    'trigger-clear-history'
];

contextBridge.exposeInMainWorld('electronAPI', {
    invoke: (channel, ...args) => {
        if (validSendChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args);
        }
        console.error(`Invalid invoke channel attempted: ${channel}`);
        return Promise.reject(new Error(`Invalid IPC channel: ${channel}`));
    },
    on: (channel, func) => {
        if (validReceiveChannels.includes(channel)) {
            const subscription = (event, ...args) => func(...args);
            ipcRenderer.on(channel, subscription);
            return () => ipcRenderer.removeListener(channel, subscription);
        }
        console.error(`Invalid listener channel attempted: ${channel}`);
        return () => {};
    },
});

console.log('Preload script executed.');