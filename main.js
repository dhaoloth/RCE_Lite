const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fileUtils = require('./src/fileUtils');
const githubService = require('./src/githubService'); // Хотя не используется напрямую здесь, оставим для полноты
const repoStats = require('./src/repoStats');
const fsp = require('fs/promises');
const fs = require('fs'); // Используется в exportProject через fileUtils

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
        icon: path.join(__dirname, 'assets/icons/icon.png') // Убедитесь, что путь к иконке верный
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
                    label: 'Open Local Folder...', // Изменено для ясности
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
         if (store) { // Проверяем, что store инициализирован перед созданием окна
             createWindow();
         } else {
             app.whenReady().then(createWindow).catch(err => { // Если store не готов, ждем готовности приложения
                 console.error('Error creating window on activate after ready:', err);
             });
         }
    }
});

// --- Регистрация Обработчиков IPC ---

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

ipcMain.handle('fs:readDirectoryStructure', async (event, dirPath, isGitHub = false) => { // Добавлен isGitHub
    if (!dirPath) {
        return { success: false, error: { message: "Directory path is required." } };
    }

    console.log('[fs:readDirectoryStructure] Reading structure for:', dirPath, 'isGitHub:', isGitHub);

    // Заглушка для GitHub
    if (isGitHub) {
        console.warn('[fs:readDirectoryStructure] GitHub structure reading is disabled.');
        return { success: true, data: { structure: { name: 'GitHub Repo (Disabled)', path: dirPath, type: 'directory', children: [] }, stats: { files: 0, directories: 0, size: 'N/A', languages: [] } } };
    }

    try {
        console.log('[fs:readDirectoryStructure] Getting local directory structure...');
        const structure = await fileUtils.getDirectoryStructureRecursive(dirPath);

        console.log('[fs:readDirectoryStructure] Analyzing repository...');
        const stats = await repoStats.analyzeRepository(dirPath, false); // isGitHub всегда false для локальной структуры

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

    // Заглушка для GitHub URL
    if (githubService.isGitHubUrl(filePath)) {
         console.warn(`[fs:readFileContent] Attempted to read GitHub file content (disabled): ${filePath}`);
         return { success: false, error: { message: "Reading GitHub file content is currently disabled." } };
    }

    try {
        const content = await fileUtils.readFileContent(filePath);
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

    // Запрет записи для GitHub URL (на всякий случай)
    if (githubService.isGitHubUrl(filePath)) {
        console.warn(`[fs:writeFileContent] Attempted to write GitHub file (forbidden): ${filePath}`);
        return { success: false, error: { message: "Cannot write to GitHub files directly." } };
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

ipcMain.handle('history:add', async (event, pathToAdd) => { // Переименовал аргумент для ясности
    if (!store) {
        console.error('[history:add] Store not initialized');
        return { success: false, error: { message: 'Store not initialized' } };
    }
    console.log('[history:add] Adding path to history:', pathToAdd);
    if (!pathToAdd) {
        console.warn('[history:add] Empty path provided');
        return { success: false, error: { message: 'Path is required' } };
    }

    try {
        let history = store.get('history', []);
        history = history.filter(p => p !== pathToAdd);
        history.unshift(pathToAdd);
        history = history.slice(0, 5); // Ограничение на 5 элементов
        store.set('history', history);
        console.log('[history:add] Updated history:', history);
        return { success: true, data: history }; // Возвращаем обновленную историю
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
        return { success: true, data: [] }; // Возвращаем пустой массив
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
            return { success: true, data: null }; // Успех, но данные null (отмена)
        }
        const selectedPath = result.filePaths[0];
        await fileUtils.validateDirectory(selectedPath); // Проверяем доступность
        return { success: true, data: selectedPath };
    } catch (error) {
        return { success: false, error: { message: error.message } };
    }
});

// --- ДОБАВЛЕННЫЙ ОБРАБОТЧИК ЭКСПОРТА ---
ipcMain.handle('project:export', async (event, basePath) => {
    if (!basePath) {
        console.error('[project:export] Base path is required for export.');
        return { success: false, error: { message: "Base path is required for export." } };
    }
    console.log('[project:export] Starting export for:', basePath);

    const baseName = path.basename(basePath);
    const defaultFileNameBase = `repo-export-${baseName}`;
    let savePath = '';

    try {
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
            console.log('[project:export] Export cancelled by user.');
            return { success: true, data: { message: 'Export cancelled.' } };
        }

        savePath = exportDialogResult.filePath;
        const chosenExtension = path.extname(savePath).toLowerCase();

        let exportFormat = 'md';
        if (chosenExtension === '.xml') {
            exportFormat = 'xml';
        } else if (chosenExtension === '.txt') {
            exportFormat = 'structure';
        }

        console.log(`[project:export] Exporting as ${exportFormat} to ${savePath}`);

        const exportOptions = {
           allowedExtensions: [
               '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.jsonc', '.json5',
               '.html', '.htm', '.xhtml', '.xml', '.xaml', '.svg', '.vue', '.svelte',
               '.css', '.scss', '.sass', '.less', '.styl',
               '.md', '.markdown', '.txt', '.rtf', '.tex', '.bib',
               '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.properties', '.env', '.env.*', '.pem', '.key', '.crt', '.csr',
               '.py', '.pyw', '.rb', '.rbw', '.java', '.kt', '.kts', '.groovy', '.gvy', '.gy', '.gsh', // .class удален
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
               // JSX/TSX уже есть
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
               '*.mp3', '*.wav', '.ogg', '.flac',
               '*.mp4', '*.avi', '*.mov', '*.wmv', '*.mkv',
               '*.jpg', '*.jpeg', '*.png', '*.gif', '*.bmp', '*.tiff', '*.webp', '*.ico',
               '*.pdf', '*.doc', '*.docx', '*.xls', '*.xlsx', '*.ppt', '*.pptx', '*.odt', '*.ods', '*.odp',
               '*.psd', '*.ai', '*.eps',
               '*.eot', '*.ttf', '*.woff', '*.woff2',
               'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'Gemfile.lock', 'Cargo.lock', 'poetry.lock'
           ]
        };

        const status = await fileUtils.exportProject(basePath, savePath, exportFormat, exportOptions);

        shell.showItemInFolder(savePath);
        console.log(`[project:export] Export successful: ${status}`);
        return { success: true, data: { message: `Project exported as ${exportFormat.toUpperCase()} to ${savePath}. ${status}` } };

    } catch (error) {
        console.error("[project:export] Export failed:", error);
        const errorContext = savePath ? ` to ${savePath}` : '';
        // Убедимся, что mainWindow существует перед показом диалога ошибки
        if (mainWindow) {
             dialog.showErrorBox('Export Error', `Export failed${errorContext}: ${error.message}`);
        }
        return { success: false, error: { message: `Export failed${errorContext}: ${error.message}` } };
    }
});
// --- КОНЕЦ ОБРАБОТЧИКА ЭКСПОРТА ---

async function findRepositories(dirPath, maxDepth = 5, currentDepth = 0) { // Добавил параметры по умолчанию
    if (currentDepth > maxDepth) {
        return [];
    }

    let foundRepos = [];
    let dirents;

    try {
        dirents = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
        // Игнорируем ошибки доступа и продолжаем сканирование других директорий
        console.warn(`Skipping inaccessible directory ${dirPath}: ${err.message}`);
        return []; // Возвращаем пустой массив для этой ветки
    }

    let hasGit = false;
    const subDirPromises = [];

    for (const dirent of dirents) {
        const fullPath = path.join(dirPath, dirent.name);
        const lowerCaseName = dirent.name.toLowerCase();

        if (lowerCaseName === '.git' && dirent.isDirectory()) {
            hasGit = true;
            break; // Если нашли .git, дальше в этой папке искать не нужно
        } else if (dirent.isDirectory() && lowerCaseName !== 'node_modules' && !dirent.name.startsWith('.')) {
             // Добавляем обещание сканирования поддиректории
             subDirPromises.push(findRepositories(fullPath, maxDepth, currentDepth + 1));
        }
    }

     if (hasGit) {
        // Если нашли .git, добавляем текущую директорию и не идем глубже
        foundRepos.push(dirPath);
     } else {
         // Если .git не нашли, ждем результатов сканирования поддиректорий
         const subDirResults = await Promise.all(subDirPromises);
         // Собираем результаты из всех поддиректорий
         foundRepos = [].concat(...subDirResults);
     }

     // Возвращаем найденные репозитории (на верхнем уровне вызова Set не нужен, т.к. логика исключает дублирование)
     return foundRepos;
}

ipcMain.handle('fs:findRepositories', async (event, dirPath) => {
    if (!dirPath) {
        return { success: false, error: { message: "Directory path is required for scanning." } };
    }
    console.log('[fs:findRepositories] Finding repositories in:', dirPath);
    try {
        const repositories = await findRepositories(dirPath); // Используем обновленную функцию
        console.log(`[fs:findRepositories] Found ${repositories.length} repositories.`);
        return { success: true, data: repositories };
    } catch (error) {
        console.error(`[fs:findRepositories] Error scanning for repositories:`, error);
        return { success: false, error: { message: `Failed to scan for repositories: ${error.message}` } };
    }
});