const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fileUtils = require('./src/fileUtils'); // Our backend logic module

let mainWindow;

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 600,
        minHeight: 400,
        title: "Repo Console Lite",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: false,
        },
        icon: path.join(__dirname, 'assets/icons/icon.png') // Optional
    });

    // Simple Menu
    const menu = Menu.buildFromTemplate([
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open Folder...',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => mainWindow.webContents.send('trigger-open-folder') // Trigger renderer action
                },
                {
                    label: 'Export Project Content...',
                    accelerator: 'CmdOrCtrl+E',
                    click: () => mainWindow.webContents.send('trigger-export-project') // Trigger renderer action
                 },
                { type: 'separator' },
                { role: process.platform === 'darwin' ? 'close' : 'quit' }
            ]
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
         {
             role: 'help',
             submenu: [ { label: 'Learn More (Placeholder)', click: async () => { await shell.openExternal('https://electronjs.org') } } ]
         }
    ]);
    Menu.setApplicationMenu(menu);


    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools(); // Uncomment for debugging

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// --- IPC Handlers ---

// Generic wrapper for handling IPC calls safely
async function handleIpc(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
        console.log(`IPC <= ${channel}`, args.length > 0 ? args : '');
        try {
            const result = await handler(...args);
            return { success: true, data: result };
        } catch (error) {
            console.error(`IPC => ${channel} ERROR:`, error.message);
            // Send back a serializable error object
            return { success: false, error: { message: error.message, name: error.name, stack: error.stack } };
        }
    });
}

// Handle selecting a directory
// Handle selecting a directory
handleIpc('dialog:openDirectory', async () => {
    if (!mainWindow) {
        // Handle case where the main window doesn't exist
        console.error('dialog:openDirectory called but mainWindow is null.');
        throw new Error("Main application window not found."); // Throw error to be caught by handleIpc
    }
    console.log('Main process: Showing open dialog...'); // Log Main 1
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'showHiddenFiles'],
        title: "Select Project Folder"
    });
    console.log('Main process: Dialog result:', result); // Log Main 2

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        console.log('Main process: Dialog cancelled by user.'); // Log Main 3a
        // Return success:false or null data explicitly for cancellation for clarity?
        // Let's return null data, handleIpc wrapper makes it { success: true, data: null }
        // Or explicitly return success: false? Let's stick to null for now.
         return null; // Indicate cancellation or no selection
    }

    const selectedPath = result.filePaths[0];
    console.log(`Main process: Path selected: ${selectedPath}`); // Log Main 3b

    // Basic validation (inside the handler before returning)
    try {
        await fileUtils.validateDirectory(selectedPath); // Use helper function
        console.log(`Main process: Path validated: ${selectedPath}`); // Log Main 4
        return selectedPath; // Return path on success
    } catch (validationError) {
        console.error(`Main process: Validation Error - ${validationError.message}`); // Log Main 5
        // Let handleIpc catch this and return { success: false, error: validationError }
        throw validationError; // Re-throw for handleIpc wrapper
    }
});

// Handle reading directory structure
// Handle reading directory structure
handleIpc('fs:readDirectoryStructure', async (dirPath) => { // <--- Make handler async
    console.log(`[Main:fs:readDirectoryStructure] Received path: ${dirPath}`); // Log received path
    if (!dirPath) {
        console.error('[Main:fs:readDirectoryStructure] Error: Directory path is required.');
        throw new Error("Directory path is required.");
    }
    try {
        console.log(`[Main:fs:readDirectoryStructure] Calling fileUtils.getDirectoryStructureRecursive for: ${dirPath}`);
        // Add await because getDirectoryStructureRecursive is async
        const structure = await fileUtils.getDirectoryStructureRecursive(dirPath);
        console.log(`[Main:fs:readDirectoryStructure] fileUtils.getDirectoryStructureRecursive completed successfully.`);
        return structure;
    } catch (error) {
        console.error(`[Main:fs:readDirectoryStructure] Error during fileUtils call: ${error.message}`, error.stack);
        throw error; // Re-throw for handleIpc wrapper to format the error response
    }
});

// Handle reading file content
handleIpc('fs:readFileContent', (filePath) => {
    if (!filePath) throw new Error("File path is required.");
    return fileUtils.readFileContent(filePath);
});

// Handle exporting project content
handleIpc('project:export', async (basePath) => {
    if (!basePath) throw new Error("Base path is required for export.");

    // Ask user where to save the exported file
    const defaultFileName = `repo-export-${path.basename(basePath)}.md`;
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Exported Project Content',
        defaultPath: path.join(app.getPath('documents'), defaultFileName),
        filters: [{ name: 'Markdown Files', extensions: ['md'] }, { name: 'Text Files', extensions: ['txt'] }]
    });

    if (result.canceled || !result.filePath) {
        return { message: 'Export cancelled.' }; // Indicate cancellation
    }

    const savePath = result.filePath;

    // Perform the export in the background (main process)
    try {
        // Define file extensions to include (adjust as needed)
        const allowedExtensions = [
            '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', // JavaScript/TypeScript
            '.html', '.htm', '.css', '.scss', '.sass', '.less', // Web Frontend
            '.json', '.yaml', '.yml', '.toml', '.xml', '.md', '.txt', // Data/Markup/Text
            '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rb', '.php', '.swift', // Backend/Languages
            '.sql', '.sh', '.bash', '.zsh', '.ps1', '.bat', // Scripts & Queries
            '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.env', // Config files (dotfiles)
            'dockerfile', 'docker-compose.yml', 'vagrantfile', 'makefile', // Build/Infra files (no extension or specific name)
            '.conf', '.cfg', '.ini', // Common config extensions
        ];
        // Define paths/names to always ignore
        const ignoredItems = ['.git', 'node_modules', 'dist', 'build', 'coverage', 'vendor', 'tmp', '.cache', '.DS_Store', 'Thumbs.db'];

        // Stream the export for potentially large projects
        const status = await fileUtils.exportProjectToString(basePath, savePath, allowedExtensions, ignoredItems);

        // Show the exported file in the file explorer
        shell.showItemInFolder(savePath);

        return { message: `Project exported successfully to ${savePath}. ${status}` };

    } catch (error) {
        console.error("Export failed:", error);
        // Re-throw to be caught by handleIpc wrapper
        throw new Error(`Export failed: ${error.message}`);
    }
});

// Handler for showing errors (optional, can be handled fully in renderer)
ipcMain.on('show-error-main', (event, title, message) => {
     dialog.showErrorBox(title || 'Error', message || 'An unexpected error occurred.');
});