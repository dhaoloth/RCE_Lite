const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fileUtils = require('./src/fileUtils');
const githubService = require('./src/githubService');
const repoStats = require('./src/repoStats');
const fsp = require('fs/promises');
const fs = require('fs');

let mainWindow;
let store;

async function initializeStore() {
    const Store = (await import('electron-store')).default;
    store = new Store();
}

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
        icon: path.join(__dirname, 'assets/icons/icon.png')
    });

    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Scan Home Directory...',
                    click: () => mainWindow.webContents.send('trigger-scan-home')
                },
                { type: 'separator' },
                {
                    label: 'History',
                    id: 'history-menu',
                    submenu: [
                        { label: 'Clear History', click: () => mainWindow.webContents.send('trigger-clear-history') },
                    ]
                },
                { type: 'separator' },
                {
                    label: 'Open Folder...',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => mainWindow.webContents.send('trigger-open-folder')
                },
                {
                    label: 'Export Project Content...',
                    accelerator: 'CmdOrCtrl+E',
                    click: () => mainWindow.webContents.send('trigger-export-project')
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
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    mainWindow.loadFile('index.html');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(async () => {
    try {
        await initializeStore();
        console.log('electron-store loaded and initialized.');
        await createWindow();
    } catch (error) {
        console.error('Failed to load electron-store or create window:', error);
        dialog.showErrorBox('Fatal Error', `Failed to initialize application components: ${error.message}`);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
         console.log('App activation requested, waiting for ready state if not initialized.');
         if (store) {
             createWindow();
         }
    }
});

async function handleIpc(event, channel, ...args) {
    console.log(`[IPC] Received ${channel} event with args:`, args);
    switch (channel) {
        case 'fs:readDirectoryStructure':
            try {
                const [dirPath, isGitHub] = args;
                let structure;
                let stats;

                if (isGitHub) {
                    structure = await githubService.getRepositoryStructure(dirPath);
                } else {
                    structure = await fileUtils.getDirectoryStructureRecursive(dirPath);
                }

                if (structure) {
                    stats = await repoStats.analyzeRepository(dirPath, isGitHub);
                }

                return { success: true, data: { structure, stats } };
            } catch (error) {
                console.error(`[IPC] Error in fs:readDirectoryStructure:`, error);
                return { success: false, error: { message: error.message } };
            }
        case 'fs:readFileContent':
            if (!args[0]) throw new Error("File path is required.");
            
            try {
                if (githubService.isGitHubUrl(args[0])) {
                    const content = await githubService.getFileContent(args[0]);
                    return { success: true, data: content };
                } else {
                    const content = await fileUtils.readFileContent(args[0]);
                    return { success: true, data: content };
                }
            } catch (error) {
                console.error(`[Main:fs:readFileContent] Error reading file: ${error.message}`, error.stack);
                return { success: false, error: { message: error.message } };
            }
        case 'fs:writeFileContent':
            if (!args[0]) throw new Error("File path is required for saving.");
            if (args[1] === null || args[1] === undefined) throw new Error("Content is required for saving.");

            try {
                await fsp.writeFile(args[0], args[1], 'utf-8');
                console.log(`File saved successfully: ${args[0]}`);
                return { success: true, data: { message: 'File saved successfully.' } };
            } catch (error) {
                console.error(`Error saving file ${args[0]}:`, error);
                if (error.code === 'EACCES') {
                    return { success: false, error: { message: `Permission denied saving file: ${args[0]}` } };
                } else if (error.code === 'ENOENT') {
                     return { success: false, error: { message: `Cannot save file, path may no longer exist: ${args[0]}` } };
                } else {
                    return { success: false, error: { message: `Failed to save file: ${error.message}` } };
                }
            }
        case 'project:export':
            if (!args[0]) throw new Error("Base path is required for export.");

            const baseName = path.basename(args[0]);
            const defaultFileNameBase = `repo-export-${baseName}`;

            const exportDialogResult = await dialog.showSaveDialog(mainWindow, {
                title: 'Save Exported Project Content',
                defaultPath: path.join(app.getPath('documents'), `${defaultFileNameBase}.md`),
                filters: [
                    { name: 'Markdown File', extensions: ['md'] },
                    { name: 'XML File', extensions: ['xml'] },
                    { name: 'Structure File (Text)', extensions: ['txt'] },
                ]
            });

            if (exportDialogResult.canceled || !exportDialogResult.filePath) {
                return { success: true, data: { message: 'Export cancelled.' } };
            }

            const savePath = exportDialogResult.filePath;
            const chosenExtension = path.extname(savePath).toLowerCase();

            let exportFormat = 'md';
            if (chosenExtension === '.xml') {
                exportFormat = 'xml';
            } else if (chosenExtension === '.txt') {
                exportFormat = 'structure';
            }

            try {
                const exportOptions = {
                    allowedExtensions: [
                        '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.jsonc', '.json5',
                        '.html', '.htm', '.xhtml', '.xml', '.xaml', '.svg', '.vue', '.svelte',
                        '.css', '.scss', '.sass', '.less', '.styl',
                        '.md', '.markdown', '.txt', '.rtf', '.tex', '.bib',
                        '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.properties', '.env', '.env.*', '.pem', '.key', '.crt', '.csr',
                        '.py', '.pyw', '.rb', '.rbw', '.java', '.class', '.kt', '.kts', '.groovy', '.gvy', '.gy', '.gsh',
                        '.c', '.cpp', '.cxx', '.h', '.hpp', '.hxx', '.cs', '.fs', '.fsi', '.fsx', '.fsscript',
                        '.go', '.rs', '.swift', '.mm', '.m', '.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps',
                        '.pl', '.pm', '.pod', '.t',
                        '.sh', '.bash', '.zsh', '.fish', '.bat', '.cmd', '.ps1', '.psm1',
                        '.sql', '.ddl', '.dml', '.pgsql', '.mysql', '.sqlite',
                        '.r', '.lua', '.scala', '.sc', '.dart', '.pas', '.dfm', '.lpr',
                        '.vb', '.vbs', '.bas', '.cls',
                        '.asm', '.s',
                        '.dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
                        'vagrantfile', 'makefile', 'gemfile', 'rakefile', 'build.gradle', 'settings.gradle', 'pom.xml',
                        '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.yarnrc', '.babelrc', '.eslintrc', '.prettierrc', '.stylelintrc',
                        '.csproj', '.vbproj', '.sln', '.vcxproj', '.pbxproj', 'project.json', 'package.json', 'composer.json', 'requirements.txt', 'pipfile', 'pyproject.toml', 'cargo.toml',
                        '.http', '.rest',
                        '.applescript', '.scpt',
                        '.liquid', '.mustache', '.hbs', '.ejs', '.pug', '.jade', '.haml', '.slim',
                        '.graphql', '.gql',
                        '.tf', '.tfvars', '.hcl',
                        '.nunjucks', '.njk',
                        '.clj', '.cljs', '.cljc', '.edn',
                        '.erl', '.hrl', '.ex', '.exs',
                        '.hs', '.lhs',
                        '.feature',
                        '.jsx', '.tsx',
                    ],
                    ignoredItems: [
                        '.git', 'node_modules', 'bower_components', 'vendor',
                        'dist', 'build', 'out', 'target', 'bin', 'obj', 'Release', 'Debug',
                        'coverage', '.nyc_output',
                        'tmp', '.temp', '.cache', '.idea', '.vscode', '.history',
                        '.DS_Store', 'Thumbs.db',
                        '*.log', '*.lock',
                        '*.swp', '*.swo', '*~', '.*.swp', '.*.swo',
                        '*.pdb', '*.idb', '*.ilk',
                        '*.pyc', '*.pyo', '__pycache__',
                        '*.class', '*.jar', '*.war', '*.ear',
                        '*.o', '*.obj', '*.so', '*.dylib', '*.dll', '*.lib', '*.a', '*.out', '*.exe', '*.app', '*.msi', '*.pkg', '*.deb', '*.rpm',
                        '*.zip', '*.tar', '*.gz', '*.bz2', '*.xz', '*.rar', '*.7z',
                        '*.dmg', '*.iso', '*.img', '*.vmdk', '*.ova',
                        '*.mp3', '*.wav', '*.ogg', '*.flac',
                        '*.mp4', '*.avi', '*.mov', '*.wmv', '*.mkv',
                        '*.jpg', '*.jpeg', '*.png', '*.gif', '*.bmp', '*.tiff', '*.webp', '*.svg', '*.ico',
                        '*.pdf', '*.doc', '*.docx', '*.xls', '*.xlsx', '*.ppt', '*.pptx', '*.odt', '*.ods', '*.odp',
                        '*.psd', '*.ai', '*.eps',
                        '*.eot', '*.ttf', '*.woff', '*.woff2',
                        'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'Gemfile.lock', 'Cargo.lock', 'poetry.lock'
                    ]
                };

                const status = await fileUtils.exportProject(args[0], savePath, exportFormat, exportOptions);

                shell.showItemInFolder(savePath);
                return { success: true, data: { message: `Project exported as ${exportFormat.toUpperCase()} to ${savePath}. ${status}` } };

            } catch (error) {
                console.error("Export failed:", error);
                return { success: false, error: { message: `Export failed: ${error.message}` } };
            }
        case 'show-error-main':
            dialog.showErrorBox(args[0] || 'Error', args[1] || 'An unexpected error occurred.');
            return { success: true };
        case 'history:get':
            return store.get('history', []);
        case 'history:add':
            if (!args[0]) throw new Error('Cannot add empty path to history.');
            let history = store.get('history', []);
            history = history.filter(p => p !== args[0]);
            history.unshift(args[0]);
            history = history.slice(0, 5);
            store.set('history', history);
            return history;
        case 'history:clear':
            store.set('history', []);
            return [];
        case 'dialog:selectHomeDirectory':
            if (!mainWindow) throw new Error("Main application window not found.");
            const dialogResult = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory', 'showHiddenFiles'],
                title: "Select Home Directory for Scanning Repositories"
            });
            if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
                return null;
            }
            const selectedPath = dialogResult.filePaths[0];
            try {
                await fileUtils.validateDirectory(selectedPath);
                return selectedPath;
            } catch (validationError) {
                throw validationError;
            }
        case 'fs:findRepositories':
            if (!args[0]) throw new Error("Home path is required for scanning.");
            try {
                const repoPaths = await fileUtils.findGitRepositories(args[0]);
                return repoPaths;
            } catch (error) {
                console.error(`Error scanning for repositories in ${args[0]}:`, error);
                throw new Error(`Failed to scan for repositories: ${error.message}`);
            }
        default:
            console.error(`[IPC] Unknown channel: ${channel}`);
            return { success: false, error: { message: `Unknown channel: ${channel}` } };
    }
}

// Register IPC handlers
ipcMain.handle('dialog:openDirectory', async () => {
    if (!mainWindow) {
        console.error('dialog:openDirectory called but mainWindow is null.');
        throw new Error("Main application window not found.");
    }
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'showHiddenFiles'],
        title: "Select Project Folder"
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { success: false, data: null };
    }

    const selectedPath = result.filePaths[0];
    try {
        await fileUtils.validateDirectory(selectedPath);
        return { success: true, data: selectedPath };
    } catch (validationError) {
        return { success: false, error: { message: validationError.message } };
    }
});

ipcMain.handle('fs:readDirectoryStructure', async (event, dirPath, isGitHub) => {
    if (!dirPath) {
        return { success: false, error: { message: "Directory path is required." } };
    }

    console.log('[fs:readDirectoryStructure] Reading structure for:', dirPath);
    console.log('[fs:readDirectoryStructure] isGitHub:', isGitHub);

    try {
        let structure;
        if (isGitHub) {
            console.log('[fs:readDirectoryStructure] Getting GitHub repository structure...');
            structure = await githubService.getRepositoryStructure(dirPath);
        } else {
            console.log('[fs:readDirectoryStructure] Getting local directory structure...');
            structure = await fileUtils.getDirectoryStructureRecursive(dirPath);
        }

        console.log('[fs:readDirectoryStructure] Structure received:', {
            hasStructure: !!structure,
            type: structure?.type,
            childrenCount: structure?.children?.length
        });

        console.log('[fs:readDirectoryStructure] Analyzing repository...');
        const stats = await repoStats.analyzeRepository(dirPath, isGitHub);
        console.log('[fs:readDirectoryStructure] Stats received:', stats);
        
        return { success: true, data: { structure, stats } };
    } catch (error) {
        console.error(`[fs:readDirectoryStructure] Error during structure fetch:`, error);
        return { success: false, error: { message: error.message } };
    }
});

ipcMain.handle('fs:readFileContent', async (event, filePath) => {
    if (!filePath) {
        return { success: false, error: { message: "File path is required." } };
    }
    
    try {
        let content;
        if (githubService.isGitHubUrl(filePath)) {
            content = await githubService.getFileContent(filePath);
        } else {
            content = await fileUtils.readFileContent(filePath);
        }
        return { success: true, data: content };
    } catch (error) {
        console.error(`[Main:fs:readFileContent] Error reading file: ${error.message}`, error.stack);
        return { success: false, error: { message: error.message } };
    }
});

ipcMain.handle('fs:writeFileContent', async (event, filePath, content) => {
    if (!filePath) {
        return { success: false, error: { message: "File path is required for saving." } };
    }
    if (content === null || content === undefined) {
        return { success: false, error: { message: "Content is required for saving." } };
    }

    try {
        await fsp.writeFile(filePath, content, 'utf-8');
        console.log(`File saved successfully: ${filePath}`);
        return { success: true, data: { message: 'File saved successfully.' } };
    } catch (error) {
        console.error(`Error saving file ${filePath}:`, error);
        if (error.code === 'EACCES') {
            return { success: false, error: { message: `Permission denied saving file: ${filePath}` } };
        } else if (error.code === 'ENOENT') {
            return { success: false, error: { message: `Cannot save file, path may no longer exist: ${filePath}` } };
        } else {
            return { success: false, error: { message: `Failed to save file: ${error.message}` } };
        }
    }
});

// History IPC handlers
ipcMain.handle('history:get', async () => {
    if (!store) {
        console.error('[history:get] Store not initialized');
        return { success: false, error: { message: 'Store not initialized' } };
    }
    console.log('[history:get] Getting history from store');
    const history = store.get('history', []);
    console.log('[history:get] History:', history);
    return { success: true, data: history };
});

ipcMain.handle('history:add', async (event, path) => {
    if (!store) {
        console.error('[history:add] Store not initialized');
        return { success: false, error: { message: 'Store not initialized' } };
    }
    console.log('[history:add] Adding path to history:', path);
    if (!path) {
        console.warn('[history:add] Empty path provided');
        return { success: false, error: { message: 'Path is required' } };
    }

    try {
        let history = store.get('history', []);
        
        // Remove if exists
        history = history.filter(p => p !== path);
        
        // Add to beginning
        history.unshift(path);
        
        // Keep only last 5 entries
        history = history.slice(0, 5);
        
        store.set('history', history);
        console.log('[history:add] Updated history:', history);
        
        return { success: true, data: history };
    } catch (error) {
        console.error('[history:add] Error:', error);
        return { success: false, error: { message: error.message } };
    }
});

ipcMain.handle('history:clear', async () => {
    if (!store) {
        console.error('[history:clear] Store not initialized');
        return { success: false, error: { message: 'Store not initialized' } };
    }
    console.log('[history:clear] Clearing history');
    try {
        store.set('history', []);
        console.log('[history:clear] History cleared');
        return { success: true };
    } catch (error) {
        console.error('[history:clear] Error:', error);
        return { success: false, error: { message: error.message } };
    }
});

ipcMain.handle('dialog:selectHomeDirectory', async () => {
    if (!mainWindow) {
        return { success: false, error: { message: "Main application window not found." } };
    }
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'showHiddenFiles'],
            title: "Select Home Directory for Scanning Repositories"
        });
        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
            return { success: true, data: null };
        }
        const selectedPath = result.filePaths[0];
        await fileUtils.validateDirectory(selectedPath);
        return { success: true, data: selectedPath };
    } catch (error) {
        return { success: false, error: { message: error.message } };
    }
});

async function findRepositories(dirPath) {
    try {
        const repositories = [];
        const queue = [dirPath];

        while (queue.length > 0) {
            const currentPath = queue.shift();
            try {
                const entries = await fsp.readdir(currentPath, { withFileTypes: true });

                // Check if current directory is a Git repository
                if (entries.some(entry => entry.name === '.git' && entry.isDirectory())) {
                    repositories.push(currentPath);
                    continue; // Skip scanning subdirectories of a repository
                }

                // Add subdirectories to queue
                for (const entry of entries) {
                    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
                        queue.push(path.join(currentPath, entry.name));
                    }
                }
            } catch (error) {
                console.warn(`Skipping inaccessible directory ${currentPath}:`, error.message);
                continue;
            }
        }

        return { success: true, data: repositories };
    } catch (error) {
        console.error('Error finding repositories:', error);
        return { success: false, error: { message: error.message } };
    }
}

// Register IPC handlers
ipcMain.handle('fs:findRepositories', async (event, dirPath) => {
    if (!dirPath) {
        return { success: false, error: { message: "Directory path is required for scanning." } };
    }
    console.log('Finding repositories in:', dirPath);
    return findRepositories(dirPath);
});