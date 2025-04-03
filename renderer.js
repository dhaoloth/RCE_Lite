let currentRepoPath = null;
let currentFileTree = null;
let selectedFilePath = null;
let isEditing = false;
let originalFileContent = null;
let navigationHistory = [];
let currentHistoryIndex = -1;

const PATH_SEP_REGEX = /[\\/]/;

const elements = {
    openFolderBtn: document.getElementById('open-folder-btn'),
    openGithubBtn: document.getElementById('open-github-btn'), 
    scanHomeBtn: document.getElementById('scan-home-btn'),   
    exportProjectBtn: document.getElementById('export-project-btn'),
    fileTreeContainer: document.getElementById('file-tree'),
    repoRootNameSpan: document.getElementById('repo-root-name'),
    fileViewerHeader: document.getElementById('viewer-header'),
    viewedFilePathSpan: document.getElementById('viewed-file-path'),
    fileContentDisplay: document.getElementById('file-content-display'),
    fileContentEditor: document.getElementById('file-content-editor'),
    viewerPlaceholder: document.getElementById('viewer-placeholder'),
    statusBar: document.getElementById('status-bar'),
    statusMessageSpan: document.getElementById('status-message'),
    exportProgressSpan: document.getElementById('export-progress'),
    historyBtn: document.getElementById('history-btn'),
    historyDropdown: document.getElementById('history-dropdown'), 
    historyDropdownContent: document.getElementById('history-dropdown-content'),
    clearHistoryLink: document.getElementById('clear-history-link'),
    saveFileBtn: document.getElementById('save-file-btn'),
    fileViewerPane: document.querySelector('.file-viewer-pane'),
};

console.log('Проверка элемента Кнопки Истории:', elements.historyBtn);
console.log('Проверка элемента Дропдауна Истории:', elements.historyDropdown);

document.addEventListener('DOMContentLoaded', () => {
    console.log('Renderer DOMContentLoaded');
    setupEventListeners();
    updateUIState();
    loadHistory();
});

function setupEventListeners() {
    // --- Существующие обработчики IPC ---
    window.electronAPI.on('show-error', handleShowError);
    window.electronAPI.on('trigger-open-folder', handleOpenLocalClick);
    window.electronAPI.on('trigger-export-project', handleExportClick);
    window.electronAPI.on('trigger-scan-home', handleScanDirsClick);
    window.electronAPI.on('trigger-clear-history', handleClearHistory); // Оставим на всякий случай, если вызывается из меню

    // --- Получение ссылок на кнопки (убедитесь, что ID верны) ---
    const openLocalBtn = document.getElementById('open-local-btn');
    const openGithubBtn = document.getElementById('open-github-btn');

    // --- Обработчик кнопки "History" ---
    if (elements.historyBtn && elements.historyDropdown) {
        elements.historyBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Остановить всплытие, чтобы клик по кнопке не закрыл тут же меню
            const dropdown = elements.historyDropdown;
            const isVisible = dropdown.classList.contains('show');

            // Функция для закрытия меню по клику вне
            const closeDropdownOnClickOutside = (event) => {
                // Проверяем, что клик был не по кнопке и не внутри самого выпадающего списка
                if (!elements.historyBtn.contains(event.target) && !dropdown.contains(event.target)) {
                    dropdown.classList.remove('show');
                    document.removeEventListener('click', closeDropdownOnClickOutside, true); // Удаляем слушатель после закрытия
                }
            };

            if (!isVisible) {
                dropdown.classList.add('show');
                // Добавляем слушатель для закрытия ТОЛЬКО когда меню открывается
                // Используем setTimeout, чтобы текущий клик не вызвал немедленное закрытие
                setTimeout(() => {
                    document.addEventListener('click', closeDropdownOnClickOutside, true);
                }, 0);
            } else {
                // Если меню уже было видимо, просто скрываем его и удаляем слушатель
                dropdown.classList.remove('show');
                document.removeEventListener('click', closeDropdownOnClickOutside, true);
            }
        });
    } else {
        console.error("History button or dropdown element not found!");
    }

    // --- Обработчик кликов ВНУТРИ выпадающего списка истории ---
    if (elements.historyDropdownContent) {
        elements.historyDropdownContent.addEventListener('click', (event) => {
            const targetLink = event.target.closest('a'); // Находим ближайшую ссылку <a>, по которой кликнули
            if (!targetLink) return; // Клик был не по ссылке

            let closeDropdownAfterAction = false; // Флаг, чтобы закрыть dropdown после действия

            // Клик по ссылке очистки истории
            if (targetLink.id === 'clear-history-link') {
                event.preventDefault(); // Предотвращаем переход по '#'
                handleClearHistory(); // Вызываем функцию очистки
                closeDropdownAfterAction = true;
            }
            // Клик по элементу истории
            else if (targetLink.dataset.path) {
                event.preventDefault(); // Предотвращаем переход по '#'
                handleHistoryItemClick(targetLink.dataset.path); // Вызываем обработчик клика по элементу
                closeDropdownAfterAction = true;
            }

            // Закрываем dropdown, если было выполнено действие
            if (closeDropdownAfterAction && elements.historyDropdown) {
                elements.historyDropdown.classList.remove('show');
                // Удаляем слушатель клика вне (на случай, если он еще активен)
                // Функция closeDropdownOnClickOutside должна быть доступна здесь, если она объявлена выше
                // Но безопаснее просто удалить по имени функции, если она не найдена
                 document.removeEventListener('click', (e) => { /* ссылка на функцию */ }, true); // Убираем слушатель
            }
        });
    } else {
         console.error("History dropdown content element not found!");
    }


    // --- Остальные обработчики (Open Local, Open GitHub, Export, Tree, Scan, Save, Editor, Keydown) ---
    if (openLocalBtn) {
        openLocalBtn.addEventListener('click', handleOpenLocalClick);
    }

    if (openGithubBtn) {
        openGithubBtn.addEventListener('click', handleOpenGitHubClick);
    }

    if (elements.exportProjectBtn) {
        elements.exportProjectBtn.addEventListener('click', handleExportClick);
    }
    if (elements.fileTreeContainer) {
        elements.fileTreeContainer.addEventListener('click', handleTreeClick);
        elements.fileTreeContainer.addEventListener('dblclick', handleTreeDoubleClick);
    }
    if (elements.scanHomeBtn) {
        elements.scanHomeBtn.addEventListener('click', handleScanDirsClick);
    }
    if (elements.saveFileBtn) {
        elements.saveFileBtn.addEventListener('click', handleSaveFile);
    }
    if (elements.fileContentEditor) {
        elements.fileContentEditor.addEventListener('input', handleEditorInput);
    }

    // Обработчик нажатий клавиш (без изменений, кроме удаления фокуса на Ctrl+H)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); handleOpenLocalClick(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') { e.preventDefault(); if (!elements.exportProjectBtn?.disabled) handleExportClick(); }
        // Убрали Ctrl+H
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            if (isEditing && !elements.saveFileBtn?.disabled) {
                e.preventDefault();
                handleSaveFile();
            }
        }
        if (e.key === 'Escape') {
             if (isEditing) {
                disableEditing(true);
             } else if (elements.historyDropdown && elements.historyDropdown.classList.contains('show')) {
                 elements.historyDropdown.classList.remove('show');
                 // Нужно удалить слушатель клика вне, если он был добавлен
                  document.removeEventListener('click', (e) => { /* ссылка на функцию */ }, true);
             }
        }
    });
}

function handleShowError(title, message) {
    console.error(`Backend Error: ${title} - ${message}`);
    updateStatus(`Error: ${message}`, 'error', 5000);
}

async function handleOpenLocalClick() {
    console.log('[handleOpenLocalClick] Opening local directory dialog.');
    updateStatus('Opening folder dialog...', 'info');
    const result = await window.electronAPI.invoke('dialog:openDirectory');
    if (result.success && result.data) {
        await setActiveRepo(result.data, false); // Явно указываем, что это не GitHub
    } else if (result.error) {
        updateStatus(`Error opening folder: ${result.error.message}`, 'error');
    } else {
        updateStatus('Folder selection cancelled.', 'info', 2000);
    }
}

function handleOpenGitHubClick() {
    console.log('Open GitHub button clicked - Placeholder.');
    updateStatus('Opening GitHub repositories is planned for a future update.', 'info', 4000);
    // Можно также использовать alert:
    // alert('Opening GitHub repositories directly is planned for a future update.');
}

function updateRepoStats(stats) {
    console.log('[updateRepoStats] Updating repository stats:', stats);
    if (!stats) {
        console.warn('[updateRepoStats] No stats provided');
        return;
    }

    const totalFilesEl = document.getElementById('total-files');
    const totalDirsEl = document.getElementById('total-dirs');
    const repoSizeEl = document.getElementById('repo-size');
    const languageListEl = document.getElementById('language-list');

    if (totalFilesEl) {
        totalFilesEl.textContent = stats.files === 1 ? '1 file' : `${stats.files} files`;
    }
    if (totalDirsEl) {
        totalDirsEl.textContent = stats.directories === 1 ? '1 folder' : `${stats.directories} folders`;
    }
    if (repoSizeEl) {
        repoSizeEl.textContent = stats.size || '0 B';
    }

    if (languageListEl) {
        languageListEl.innerHTML = '';
        if (stats.languages && stats.languages.length > 0) {
            stats.languages.forEach(lang => {
                const langTag = document.createElement('span');
                langTag.className = 'language-tag';
                langTag.textContent = lang.name;
                languageListEl.appendChild(langTag);
            });
        } else {
            languageListEl.innerHTML = '<span class="placeholder-text">No languages detected</span>';
        }
    }
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

async function setActiveRepo(repoPath, isGitHub = false) {
    if (isGitHub) {
        console.warn("[setActiveRepo] Attempted to load a GitHub repo, but feature is disabled.");
        updateStatus('GitHub loading is currently disabled.', 'warning', 3000);
        return; // Прерываем выполнение для GitHub
    }

    if (!repoPath) {
        console.error("[setActiveRepo] Received empty repoPath. Aborting.");
        return;
    }
    repoPath = String(repoPath).replace(/[\\/]+$/, '');

    console.log(`[setActiveRepo] Setting active repo: ${repoPath}`);
    console.log(`[setActiveRepo] isGitHub: ${isGitHub}`);
    updateStatus(`Loading repository: ${repoPath}...`, 'info');

    addPathToHistory(repoPath);

    if (elements.repoRootNameSpan) {
        elements.repoRootNameSpan.textContent = repoPath.split(PATH_SEP_REGEX).pop() || repoPath;
        elements.repoRootNameSpan.title = repoPath;
    }
    currentRepoPath = repoPath;
    selectedFilePath = null;
    clearFileViewer();
    updateUIState();

    try {
        console.log("[setActiveRepo] Invoking fs:readDirectoryStructure...");
        const result = await window.electronAPI.invoke('fs:readDirectoryStructure', currentRepoPath, isGitHub);
        console.log("[setActiveRepo] fs:readDirectoryStructure result received:", result);

        if (result.success) {
            currentFileTree = result.data.structure;
            console.log("[setActiveRepo] Structure received:", currentFileTree);
            console.log("[setActiveRepo] Stats received:", result.data.stats);
            
            updateRepoStats(result.data.stats);

            if (elements.fileTreeContainer) {
                elements.fileTreeContainer.innerHTML = '';
                elements.fileTreeContainer.classList.remove('scan-results-container');

                if (currentFileTree && currentFileTree.children && currentFileTree.children.length > 0) {
                    console.log("[setActiveRepo] Rendering tree with children:", currentFileTree.children.length);
                    currentFileTree.children.forEach(childNode => {
                        renderTree(childNode, elements.fileTreeContainer);
                    });
                    console.log("[setActiveRepo] Tree rendered successfully.");
                } else {
                    console.log("[setActiveRepo] No children found in tree structure");
                    elements.fileTreeContainer.innerHTML = '<p class="placeholder-text">Repository is empty.</p>';
                }
            }

            updateStatus('Repository loaded.', 'success', 2000);
        } else {
            console.error('[setActiveRepo] Failed to read repository structure:', result.error);
            updateStatus(`Error loading repository: ${result.error?.message || 'Unknown error'}`, 'error');
            if (elements.fileTreeContainer) {
                elements.fileTreeContainer.innerHTML = `<p class="placeholder-text error-text">Error loading repository: ${escapeHtml(result.error?.message || 'Unknown error')}</p>`;
            }
        }
    } catch (error) {
        console.error('[setActiveRepo] Error:', error);
        updateStatus(`Error: ${error.message}`, 'error');
        if (elements.fileTreeContainer) {
            elements.fileTreeContainer.innerHTML = `<p class="placeholder-text error-text">Error: ${escapeHtml(error.message)}</p>`;
        }
    }
}

function renderTree(node, parentElement) {
    const treeNode = document.createElement('div');
    treeNode.className = 'tree-node';
    treeNode.dataset.path = node.path;
    treeNode.dataset.type = node.type;
    if (node.isRepository) {
        treeNode.dataset.isRepository = 'true';
    }
    if (node.error) {
        treeNode.dataset.error = node.error;
        treeNode.title = node.error;
    }

    const header = document.createElement('div');
    header.className = 'tree-node-header';
    if (node.error) {
        header.classList.add('has-error');
    }

    const caret = document.createElement('div');
    caret.className = 'tree-caret';
    if (node.type === 'directory') {
        caret.innerHTML = '<i class="fas fa-caret-right"></i>';
    } else {
        caret.classList.add('placeholder');
    }
    header.appendChild(caret);

    const icon = document.createElement('i');
    icon.className = 'tree-icon';
    if (node.type === 'directory') {
        icon.classList.add('folder', 'fas', 'fa-folder');
        if (node.isRepository) {
            icon.classList.add('repository');
            icon.style.color = '#6cc644'; // GitHub green color
        }
    } else if (node.type === 'file') {
        icon.classList.add('file', 'fas');
        const ext = node.name.split('.').pop()?.toLowerCase();
        switch (ext) {
            case 'js':
            case 'jsx':
            case 'ts':
            case 'tsx':
                icon.classList.add('fa-file-code');
                icon.style.color = '#f1e05a';
                break;
            case 'html':
            case 'htm':
                icon.classList.add('fa-file-code');
                icon.style.color = '#e34c26';
                break;
            case 'css':
            case 'scss':
            case 'sass':
                icon.classList.add('fa-file-code');
                icon.style.color = '#563d7c';
                break;
            case 'json':
                icon.classList.add('fa-file-code');
                icon.style.color = '#8bc34a';
                break;
            case 'md':
                icon.classList.add('fa-file-alt');
                icon.style.color = '#b6b6b6';
                break;
            case 'jpg':
            case 'jpeg':
            case 'png':
            case 'gif':
            case 'svg':
                icon.classList.add('fa-file-image');
                icon.style.color = '#f1c40f';
                break;
            case 'pdf':
                icon.classList.add('fa-file-pdf');
                icon.style.color = '#e74c3c';
                break;
            default:
                icon.classList.add('fa-file');
                icon.style.color = '#8db9e2';
        }
    } else {
        icon.classList.add('file', 'fas', 'fa-link');
    }
    header.appendChild(icon);

    const content = document.createElement('span');
    content.className = 'tree-node-content';
    content.textContent = node.name;
    header.appendChild(content);

    if (node.size && node.type === 'file') {
        const size = document.createElement('span');
        size.className = 'file-size';
        size.textContent = node.size;
        header.appendChild(size);
    }

    if (node.error) {
        const errorIcon = document.createElement('i');
        errorIcon.className = 'tree-icon error-icon fas fa-exclamation-triangle';
        errorIcon.style.marginLeft = '5px';
        header.appendChild(errorIcon);
    }

    treeNode.appendChild(header);

    if (node.type === 'directory') {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-node-children';
        treeNode.appendChild(childrenContainer);
    }

    parentElement.appendChild(treeNode);
}

function handleTreeClick(event) {
    const header = event.target.closest('.tree-node-header');
    if (!header) return;

    const nodeElement = header.closest('.tree-node');
    if (!nodeElement) return;

    const path = nodeElement.dataset.path;
    const type = nodeElement.dataset.type;
    const isRepository = nodeElement.dataset.isRepository === 'true';

    console.log('[handleTreeClick] Clicked node:', {
        path,
        type,
        isRepository
    });

    if (isRepository) {
        console.log('[handleTreeClick] Loading repository:', path);
        setActiveRepo(path, false);
        return;
    }

    if (type === 'directory') {
        const childrenContainer = nodeElement.querySelector(':scope > .tree-node-children');
        const caret = header.querySelector('.tree-caret');
        
        if (childrenContainer && caret) {
            const isExpanded = childrenContainer.classList.toggle('tree-node-children--expanded');
            caret.classList.toggle('tree-caret--expanded', isExpanded);

            console.log('[handleTreeClick] Directory toggled:', {
                path,
                isExpanded,
                hasChildren: childrenContainer.children.length > 0
            });

            if (isExpanded && childrenContainer.children.length === 0) {
                console.log('[handleTreeClick] Loading directory contents:', path);
                loadDirectoryContents(nodeElement, path, false);
            }
        }
    } else if (type === 'file') {
        console.log('[handleTreeClick] Selecting file:', path);
        selectFile(path);
        elements.fileTreeContainer.querySelectorAll('.tree-node-header.selected').forEach(el => 
            el.classList.remove('selected')
        );
        header.classList.add('selected');
    }
}

async function loadDirectoryContents(nodeElement, path, isGitHub) {
    try {
        const result = await window.electronAPI.invoke('fs:readDirectoryStructure', path, isGitHub);
        
        if (result.success) {
            const structure = result.data.structure;
            updateRepoStats(result.data.stats);

            let childrenContainer = nodeElement.querySelector(':scope > .tree-node-children');
            if (!childrenContainer) {
                childrenContainer = document.createElement('div');
                childrenContainer.className = 'tree-node-children';
                nodeElement.appendChild(childrenContainer);
            }

            if (structure && structure.children && structure.children.length > 0) {
                structure.children.forEach(childNode => {
                    renderTree(childNode, childrenContainer);
                });
            }
        } else {
            console.error('Failed to load directory contents:', result.error);
            updateStatus(`Error loading directory: ${result.error?.message || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('Error loading directory contents:', error);
        updateStatus(`Error loading directory: ${error.message}`, 'error');
    }
}

function handleTreeDoubleClick(event) {
    const header = event.target.closest('.tree-node-header');
    if (!header || header.classList.contains('has-error')) {
        return;
    }
    const nodeElement = header.closest('.tree-node');
    if (!nodeElement) return;

    const type = nodeElement.dataset.type;
    const path = nodeElement.dataset.path;

    if (type === 'file') {
        if (selectedFilePath !== path) {
             selectFile(path).then(() => {
                enableEditing();
             });
        } else {
             enableEditing();
        }
    }
}

async function selectFile(filePath) {
    if (!filePath) return;
    console.log(`Selecting file: ${filePath}`);

    if (isEditing && elements.fileContentEditor.value !== originalFileContent) {
        if (!confirm('You have unsaved changes. Discard changes and open new file?')) {
            return;
        }
    }
    disableEditing(false);

    selectedFilePath = filePath;
    const filename = filePath.split(PATH_SEP_REGEX).pop();
    updateStatus(`Loading file: ${filename}...`, 'info');

    if (elements.viewedFilePathSpan && currentRepoPath) {
        const repoPathWithSep = currentRepoPath.endsWith('/') || currentRepoPath.endsWith('\\')
            ? currentRepoPath
            : currentRepoPath + (currentRepoPath.includes('/') ? '/' : '\\');
        elements.viewedFilePathSpan.textContent = filePath.replace(repoPathWithSep, '');
        elements.viewedFilePathSpan.title = filePath;
    } else if (elements.viewedFilePathSpan) {
        elements.viewedFilePathSpan.textContent = filename;
        elements.viewedFilePathSpan.title = filePath;
    }

    if (elements.viewerPlaceholder) elements.viewerPlaceholder.classList.add('hidden');
    if (!elements.fileContentDisplay || !elements.fileContentEditor) {
        console.error("File content elements not found!");
        updateStatus('UI Error: Cannot display file', 'error');
        return;
    }

    elements.fileContentDisplay.style.display = 'block';
    elements.fileContentEditor.style.display = 'none';
    elements.fileViewerPane?.classList.remove('editing');
    elements.fileContentDisplay.innerHTML = '';
    elements.fileContentEditor.value = '';

    try {
        const result = await window.electronAPI.invoke('fs:readFileContent', filePath);
        console.log('fs:readFileContent result received:', !!result?.data);

        if (result.success) {
            const content = result.data ?? "";
            console.log(`File content loaded successfully (${content?.length ?? 0} chars).`);
            originalFileContent = content;

            let highlightedCode = escapeHtml(content);

            if (window.hljs && typeof window.hljs.highlight === 'function') {
                const extension = filePath.split('.').pop()?.toLowerCase() || '';
                const language = window.hljs.getLanguage(extension) ? extension : null;

                if (language) {
                    try {
                        highlightedCode = window.hljs.highlight(content, { language: language, ignoreIllegals: true }).value;
                        console.log(`Highlighting successful for ${language}.`);
                    } catch (e) {
                        console.warn(`Highlighting error for ${language}, falling back:`, e);
                    }
                } else {
                    console.log("No specific language detected for highlighting.");
                }
            } else {
                console.error("Highlight.js (hljs) not available.");
            }

            elements.fileContentDisplay.innerHTML = highlightedCode;
            elements.fileContentEditor.value = content;

            console.log("File loaded. Double-click to enable editing mode.");
            updateStatus(`File loaded: ${filename}`, 'success', 2000);

        } else {
            const errorMessage = result.error?.message || 'Unknown error';
            console.error(`Failed to read file content:`, result.error);
            elements.fileContentDisplay.innerHTML = `<span class="error-text">Error loading file: ${escapeHtml(errorMessage)}</span>`;
            updateStatus(`Error loading file: ${filename} - ${errorMessage}`, 'error');
        }
    } catch (error) {
        console.error(`IPC Error reading file "${filePath}":`, error);
        if (elements.fileContentDisplay) {
            elements.fileContentDisplay.innerHTML = `<span class="error-text">IPC Error: ${escapeHtml(error.message)}</span>`;
        }
        updateStatus(`IPC Error loading file`, 'error');
    }
}

function clearFileViewer() {
    disableEditing(false);
     if (elements.fileContentDisplay) elements.fileContentDisplay.innerHTML = '';
     if (elements.fileContentEditor) elements.fileContentEditor.value = '';
    if (elements.viewedFilePathSpan) elements.viewedFilePathSpan.textContent = 'Select a file to view';
    if (elements.viewerPlaceholder) elements.viewerPlaceholder.classList.remove('hidden');
    selectedFilePath = null;
     originalFileContent = null;
}

async function handleExportClick() {
    // Проверяем, есть ли выбранный репозиторий и не отключена ли кнопка
    if (!currentRepoPath || elements.exportProjectBtn?.disabled) return;

    console.log('Starting project export for:', currentRepoPath);
    updateStatus('Preparing export...', 'info');

    // Отключаем кнопку и показываем индикатор экспорта
    if (elements.exportProjectBtn) elements.exportProjectBtn.disabled = true;
    if (elements.exportProgressSpan) {
        elements.exportProgressSpan.style.display = 'inline';
        elements.exportProgressSpan.textContent = '(Exporting...)';
    }

    try {
        // Вызываем IPC-метод в основном процессе для экспорта
        const result = await window.electronAPI.invoke('project:export', currentRepoPath);

        // Проверяем результат от основного процесса
        if (result && result.success) {
            // Экспорт успешен
            const successMessage = result.data?.message || 'Export completed successfully.';
            updateStatus(successMessage, 'success', 6000);
            console.log("Export successful:", result.data?.message);
        } else if (result && result.error) {
            // В основном процессе произошла ошибка во время экспорта
            const errorMessage = result.error.message || 'Unknown export error occurred.';
            updateStatus(`Export failed: ${errorMessage}`, 'error', 6000);
            console.error('Export Failed (from main process):', result.error);
             // Здесь можно показать диалоговое окно с ошибкой, если нужно
             // window.electronAPI.invoke('show-error-main', 'Export Error', errorMessage);
        } else {
            // Неожиданная структура ответа от основного процесса
            updateStatus('Export failed: Received an unexpected response from the main process.', 'error', 6000);
            console.error('Export Failed: Unexpected response structure:', result);
        }

    } catch (error) { // Ошибка произошла при самом вызове IPC (invoke)
        console.error('IPC Error during export invoke:', error);
        const ipcErrorMessage = error.message || 'Unknown IPC error during export.';
        updateStatus(`Export IPC Error: ${ipcErrorMessage}`, 'error', 6000);
         // Показываем диалоговое окно с ошибкой IPC
         // window.electronAPI.invoke('show-error-main', 'IPC Error', ipcErrorMessage);
    } finally {
        // В любом случае (успех или ошибка) включаем кнопку обратно и скрываем индикатор
        if (elements.exportProjectBtn) {
            // Включаем кнопку, только если репозиторий все еще загружен
            elements.exportProjectBtn.disabled = !currentRepoPath;
        }
        if (elements.exportProgressSpan) {
            elements.exportProgressSpan.style.display = 'none';
            elements.exportProgressSpan.textContent = ''; // Очищаем текст
        }
    }
}

function updateUIState() {
    const repoLoaded = !!currentRepoPath;
    if (elements.exportProjectBtn) {
        elements.exportProjectBtn.disabled = !repoLoaded;
        elements.exportProjectBtn.style.display = repoLoaded ? 'inline-flex' : 'none';
    }
}

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/&/g, "&amp;")
                 .replace(/</g, "&lt;")
                 .replace(/>/g, "&gt;")
                 .replace(/"/g, "&quot;")
                 .replace(/'/g, "&#039;");
}

let statusTimeout;
function updateStatus(message, type = 'info', duration = null) {
    if (!elements.statusMessageSpan) return;
    clearTimeout(statusTimeout);
    elements.statusMessageSpan.textContent = message;
    elements.statusMessageSpan.className = `status-message ${type}`;
    if (duration) {
        statusTimeout = setTimeout(() => {
            if (elements.statusMessageSpan.textContent === message) {
                 elements.statusMessageSpan.textContent = 'Ready';
                 elements.statusMessageSpan.className = 'status-message';
            }
        }, duration);
    }
}

async function loadHistory() {
    if (!elements.historyDropdownContent) return;
    try {
        const result = await window.electronAPI.invoke('history:get');
        if (result.success) {
             renderHistory(result.data);
        } else {
            console.error("Failed to load history (IPC):", result.error);
             updateStatus('Error loading history.', 'error');
        }
    } catch (error) {
        console.error("Failed to load history (Catch):", error);
        updateStatus('Error loading history.', 'error');
    }
}

function renderHistory(history) {
    if (!elements.historyDropdownContent) return;
    const list = elements.historyDropdownContent;

    const items = list.querySelectorAll('a[data-path]');
    items.forEach(item => item.remove());

    const placeholder = list.querySelector('.placeholder-text');
    const hr = list.querySelector('hr');
    const clearLink = list.querySelector('#clear-history-link');

    const hasHistory = history && history.length > 0;

    if (placeholder) placeholder.style.display = hasHistory ? 'none' : 'block';
    if (hr) hr.style.display = hasHistory ? 'block' : 'none';
    if (clearLink) clearLink.style.display = hasHistory ? 'block' : 'none';

    if (hasHistory && hr) {
        history.forEach(repoPath => {
            const listItem = document.createElement('a');
            listItem.href = '#';
            listItem.dataset.path = repoPath;
            listItem.textContent = repoPath.split(PATH_SEP_REGEX).pop() || repoPath;
            listItem.title = repoPath;
            list.insertBefore(listItem, hr);
        });
    }
}

async function addPathToHistory(repoPath) {
     if (!repoPath) return;
     try {
         await window.electronAPI.invoke('history:add', repoPath);
         loadHistory();
     } catch (error) {
         console.error(`Failed to add path ${repoPath} to history:`, error);
         updateStatus('Error updating history.', 'error');
     }
 }

 async function handleClearHistory() {
    if (!confirm('Are you sure you want to clear the repository history?')) return;
    try {
        const result = await window.electronAPI.invoke('history:clear');
        if(result.success) {
           renderHistory([]);
           updateStatus('History cleared.', 'success', 2000);
           if (elements.historyDropdown) {
                elements.historyDropdown.classList.remove('show');
                // Не нужно удалять слушатель здесь, т.к. он удаляется при закрытии
           }
        } else {
            console.error("Failed to clear history (IPC):", result.error);
            updateStatus('Error clearing history.', 'error');
        }
    } catch (error) {
        console.error("Failed to clear history (Catch):", error);
        updateStatus('Error clearing history.', 'error');
    }
}

 function handleHistoryItemClick(repoPath) {
    console.log(`History item clicked: ${repoPath}`);
    setActiveRepo(repoPath, false);
}

async function handleScanDirsClick() {
    console.log('Scan Dirs button clicked.');
    updateStatus('Selecting directory to scan...', 'info');
    try {
        const homeDirResult = await window.electronAPI.invoke('dialog:selectHomeDirectory');
        if (homeDirResult.success && homeDirResult.data) {
            const scanPath = homeDirResult.data;
            updateStatus(`Scanning ${scanPath} for repositories...`, 'info');
            const findResult = await window.electronAPI.invoke('fs:findRepositories', scanPath);
            if (findResult.success && findResult.data) {
                displayScanResults(findResult.data, scanPath);
            } else {
                console.error("Failed to find repositories:", findResult.error);
                updateStatus(`Scan failed: ${findResult.error?.message || 'Unknown error'}`, 'error');
            }
        } else if (homeDirResult.success && !homeDirResult.data) {
            updateStatus('Scan cancelled.', 'info');
        } else {
            console.error("Failed to select directory:", homeDirResult.error);
            updateStatus(`Error selecting directory: ${homeDirResult.error.message}`, 'error');
        }
    } catch (error) {
        console.error("Error during repository scan:", error);
        updateStatus(`Scan error: ${error.message}`, 'error');
    }
}

function displayScanResults(repositories, scanPath) {
    if (!repositories || repositories.length === 0) {
        updateStatus('No repositories found in the selected directory.', 'info', 4000);
        if (elements.fileTreeContainer) {
            elements.fileTreeContainer.innerHTML = '<p class="placeholder-text">No repositories found.</p>';
        }
        return;
    }

    updateStatus(`Found ${repositories.length} repositories.`, 'success', 3000);

    if (elements.fileTreeContainer) {
        elements.fileTreeContainer.innerHTML = '';
        elements.fileTreeContainer.classList.add('scan-results-container');

        // Sort repositories by name
        const sortedRepos = repositories.sort((a, b) => {
            const nameA = a.split(PATH_SEP_REGEX).pop().toLowerCase();
            const nameB = b.split(PATH_SEP_REGEX).pop().toLowerCase();
            return nameA.localeCompare(nameB);
        });

        // Create repository nodes
        sortedRepos.forEach(repoPath => {
            const repoNode = document.createElement('div');
            repoNode.className = 'tree-node';
            repoNode.dataset.path = repoPath;
            repoNode.dataset.type = 'directory';
            repoNode.dataset.isRepository = 'true';

            const header = document.createElement('div');
            header.className = 'tree-node-header';

            const icon = document.createElement('i');
            icon.className = 'tree-icon fas fa-folder repository';
            icon.style.color = '#6cc644';

            const content = document.createElement('span');
            content.className = 'tree-node-content';
            content.textContent = repoPath.split(PATH_SEP_REGEX).pop();
            content.title = repoPath;

            header.appendChild(icon);
            header.appendChild(content);
            repoNode.appendChild(header);
            elements.fileTreeContainer.appendChild(repoNode);
        });

        if (elements.repoRootNameSpan) {
            elements.repoRootNameSpan.textContent = "Found Repositories";
            elements.repoRootNameSpan.title = scanPath;
        }

        // Clear repository info panel
        const totalFilesEl = document.getElementById('total-files');
        const totalDirsEl = document.getElementById('total-dirs');
        const repoSizeEl = document.getElementById('repo-size');
        const languageListEl = document.getElementById('language-list');

        if (totalFilesEl) totalFilesEl.textContent = '0 files';
        if (totalDirsEl) totalDirsEl.textContent = '0 folders';
        if (repoSizeEl) repoSizeEl.textContent = '0.0 B';
        if (languageListEl) {
            languageListEl.innerHTML = '<span class="placeholder-text">No languages detected</span>';
        }

        clearFileViewer();
    }
}

function enableEditing() {
    if (!selectedFilePath || !elements.fileViewerPane || !elements.fileContentEditor || !elements.fileContentDisplay) return;

    const displayContent = elements.fileContentDisplay?.innerHTML || '';
    if(displayContent.includes('Error loading file') || displayContent.includes('Cannot display file') || displayContent.includes('File too large to view')) {
        updateStatus('Cannot edit this file type, file with errors, or large file.', 'error', 3000);
        return;
    }

     console.log('Enabling edit mode for:', selectedFilePath);
     isEditing = true;
     originalFileContent = elements.fileContentEditor.value;
     elements.fileViewerPane.classList.add('editing');
     elements.fileContentEditor.style.display = 'block';
     elements.fileContentDisplay.style.display = 'none';
     elements.fileContentEditor.focus();
     elements.saveFileBtn.style.display = 'inline-flex';
     elements.saveFileBtn.disabled = true;
     updateStatus(`Editing: ${selectedFilePath.split(PATH_SEP_REGEX).pop()}`, 'info');
}

function disableEditing(revert = false) {
     if (!elements.fileViewerPane || !elements.fileContentEditor) return;
     console.log('Disabling edit mode.');
     isEditing = false;
     if (revert && originalFileContent !== null) {
         elements.fileContentEditor.value = originalFileContent;
     }
     originalFileContent = null;
     elements.fileViewerPane.classList.remove('editing');
     elements.saveFileBtn.style.display = 'none';
     elements.fileContentEditor.style.display = 'none';
     elements.fileContentDisplay.style.display = 'block';

     if(elements.statusMessageSpan && !elements.statusMessageSpan.classList.contains('success') && !elements.statusMessageSpan.classList.contains('error')){
        updateStatus('Ready', 'info');
     }
}

function handleEditorInput() {
    if (isEditing && elements.saveFileBtn && elements.fileContentEditor) {
        elements.saveFileBtn.disabled = (elements.fileContentEditor.value === originalFileContent);
    }
}

async function handleSaveFile() {
    if (!isEditing || !selectedFilePath || !elements.fileContentEditor || elements.saveFileBtn?.disabled) {
        return;
    }
     console.log('Attempting to save file:', selectedFilePath);
     const newContent = elements.fileContentEditor.value;
     elements.saveFileBtn.disabled = true;
     updateStatus('Saving...', 'info');

     try {
         const result = await window.electronAPI.invoke('fs:writeFileContent', selectedFilePath, newContent);

         if (result.success) {
             updateStatus('File saved successfully.', 'success', 2000);
             originalFileContent = newContent;
             elements.saveFileBtn.disabled = true;

             elements.fileContentDisplay.textContent = newContent;
             if (window.hljs && typeof window.hljs.highlightElement === 'function') {
                try {
                    window.hljs.highlightElement(elements.fileContentDisplay);
                } catch (e) {
                    console.warn(`Highlighting after save failed:`, e);
                     elements.fileContentDisplay.innerHTML = escapeHtml(newContent);
                }
            } else {
                 elements.fileContentDisplay.innerHTML = escapeHtml(newContent);
            }

         } else {
             console.error('Failed to save file:', result.error);
             updateStatus(`Save failed: ${result.error.message}`, 'error', 5000);
             elements.saveFileBtn.disabled = false;
         }
     } catch (error) {
         console.error('IPC Error saving file:', error);
         updateStatus(`Save IPC Error: ${error.message}`, 'error', 5000);
         elements.saveFileBtn.disabled = false;
     }
}

async function handleLoadGitHub() {
     updateStatus('GitHub loading not implemented yet.', 'info', 3000);
     console.warn('GitHub loading needs backend implementation.');
}

async function generateMarkdown(dirPath) {
    let markdown = `# Project Structure\n\n`;

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            markdown += `## Directory: ${entry.name}\n\n`;
            markdown += await generateMarkdown(fullPath); // Рекурсивный вызов
        } else if (entry.isFile()) {
            const fileContent = await fs.readFile(fullPath, 'utf-8');
            markdown += `### File: ${entry.name}\n\`\`\`\n${fileContent}\n\`\`\`\n\n`;
        }
    }

    return markdown;
}

async function generateXML(dirPath) {
    let xml = `<project>\n`;

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            xml += `  <directory name="${entry.name}">\n`;
            xml += await generateXML(fullPath); // Рекурсивный вызов
            xml += `  </directory>\n`;
        } else if (entry.isFile()) {
            const fileContent = await fs.readFile(fullPath, 'utf-8');
            xml += `  <file name="${entry.name}">\n${fileContent}\n  </file>\n`;
        }
    }

    xml += `</project>\n`;
    return xml;
}