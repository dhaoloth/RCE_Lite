const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fileUtils = require('./src/fileUtils');
const fsp = require('fs/promises');

let mainWindow;
let Store;
let store;

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
    const electronStoreModule = await import('electron-store');
    Store = electronStoreModule.default;
    store = new Store();
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

async function handleIpc(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
        console.log(`IPC <= ${channel}`, args.length > 0 ? args : '');
        try {
            if (channel.startsWith('history:')) {
                 if (!store) {
                     throw new Error("Store is not initialized yet.");
                 }
            }
            const result = await handler(...args);
            return { success: true, data: result };
        } catch (error) {
            console.error(`IPC => ${channel} ERROR:`, error.message);
            return { success: false, error: { message: error.message, name: error.name, stack: error.stack } };
        }
    });
}

handleIpc('dialog:openDirectory', async () => {
    if (!mainWindow) {
        console.error('dialog:openDirectory called but mainWindow is null.');
        throw new Error("Main application window not found.");
    }
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'showHiddenFiles'],
        title: "Select Project Folder"
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
         return null;
    }

    const selectedPath = result.filePaths[0];
    try {
        await fileUtils.validateDirectory(selectedPath);
        return selectedPath;
    } catch (validationError) {
        throw validationError;
    }
});

handleIpc('fs:readDirectoryStructure', async (dirPath) => {
    if (!dirPath) {
        throw new Error("Directory path is required.");
    }
    try {
        const structure = await fileUtils.getDirectoryStructureRecursive(dirPath);
        return structure;
    } catch (error) {
        console.error(`[Main:fs:readDirectoryStructure] Error during fileUtils call: ${error.message}`, error.stack);
        throw error;
    }
});

handleIpc('fs:readFileContent', (filePath) => {
    if (!filePath) throw new Error("File path is required.");
    return fileUtils.readFileContent(filePath);
});

handleIpc('fs:writeFileContent', async (filePath, content) => {
    if (!filePath) throw new Error("File path is required for saving.");
    if (content === null || content === undefined) throw new Error("Content is required for saving.");

    try {
        await fsp.writeFile(filePath, content, 'utf-8');
        console.log(`File saved successfully: ${filePath}`);
        return { message: 'File saved successfully.' };
    } catch (error) {
        console.error(`Error saving file ${filePath}:`, error);
        if (error.code === 'EACCES') {
            throw new Error(`Permission denied saving file: ${filePath}`);
        } else if (error.code === 'ENOENT') {
             throw new Error(`Cannot save file, path may no longer exist: ${filePath}`);
        } else {
            throw new Error(`Failed to save file: ${error.message}`);
        }
    }
});

handleIpc('project:export', async (basePath) => {
    if (!basePath) throw new Error("Base path is required for export.");

    const baseName = path.basename(basePath);
    const defaultFileNameBase = `repo-export-${baseName}`;

    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Exported Project Content',
        defaultPath: path.join(app.getPath('documents'), `${defaultFileNameBase}.md`),
        filters: [
            { name: 'Markdown File', extensions: ['md'] },
            { name: 'XML File', extensions: ['xml'] },
            { name: 'Structure File (Text)', extensions: ['txt'] },
        ]
    });

    if (result.canceled || !result.filePath) {
        return { message: 'Export cancelled.' };
    }

    const savePath = result.filePath;
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

        const status = await fileUtils.exportProject(basePath, savePath, exportFormat, exportOptions);

        shell.showItemInFolder(savePath);
        return { message: `Project exported as ${exportFormat.toUpperCase()} to ${savePath}. ${status}` };

    } catch (error) {
        console.error("Export failed:", error);
        throw new Error(`Export failed: ${error.message}`);
    }
});

ipcMain.on('show-error-main', (event, title, message) => {
     dialog.showErrorBox(title || 'Error', message || 'An unexpected error occurred.');
});

handleIpc('history:get', () => {
    return store.get('history', []);
});

handleIpc('history:add', (repoPath) => {
    if (!repoPath) throw new Error('Cannot add empty path to history.');
    let history = store.get('history', []);
    history = history.filter(p => p !== repoPath);
    history.unshift(repoPath);
    history = history.slice(0, 5);
    store.set('history', history);
    return history;
});

handleIpc('history:clear', () => {
    store.set('history', []);
    return [];
});

handleIpc('dialog:selectHomeDirectory', async () => {
    if (!mainWindow) throw new Error("Main application window not found.");
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'showHiddenFiles'],
        title: "Select Home Directory for Scanning Repositories"
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return null;
    }
    const selectedPath = result.filePaths[0];
    try {
        await fileUtils.validateDirectory(selectedPath);
        return selectedPath;
    } catch (validationError) {
        throw validationError;
    }
});

handleIpc('fs:findRepositories', async (homePath) => {
    if (!homePath) throw new Error("Home path is required for scanning.");
    try {
        const repoPaths = await fileUtils.findGitRepositories(homePath);
        return repoPaths;
    } catch (error) {
        console.error(`Error scanning for repositories in ${homePath}:`, error);
        throw new Error(`Failed to scan for repositories: ${error.message}`);
    }
});