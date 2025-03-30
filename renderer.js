let currentRepoPath = null;
let currentFileTree = null;
let selectedFilePath = null;
let isEditing = false;
let originalFileContent = null;

const PATH_SEP_REGEX = /[\\/]/;

const elements = {
    openFolderBtn: document.getElementById('open-folder-btn'),
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
    historyDropdownContent: document.getElementById('history-dropdown-content'),
    clearHistoryLink: document.getElementById('clear-history-link'),
    scanHomeBtn: document.getElementById('scan-home-btn'),
    saveFileBtn: document.getElementById('save-file-btn'),
    fileViewerPane: document.querySelector('.file-viewer-pane'),
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('Renderer DOMContentLoaded');
    setupEventListeners();
    updateUIState();
    loadHistory();
});

function setupEventListeners() {
    window.electronAPI.on('show-error', handleShowError);
    window.electronAPI.on('trigger-open-folder', handleOpenFolderClick);
    window.electronAPI.on('trigger-export-project', handleExportClick);
    window.electronAPI.on('trigger-scan-home', handleScanDirsClick);
    window.electronAPI.on('trigger-clear-history', handleClearHistory);

    if (elements.openFolderBtn) {
        elements.openFolderBtn.addEventListener('click', handleOpenFolderClick);
    }
    if (elements.exportProjectBtn) {
        elements.exportProjectBtn.addEventListener('click', handleExportClick);
    }
    if (elements.fileTreeContainer) {
        elements.fileTreeContainer.addEventListener('click', handleTreeClick);
        elements.fileTreeContainer.addEventListener('dblclick', handleTreeDoubleClick);
    }
     if (elements.clearHistoryLink) {
        elements.clearHistoryLink.addEventListener('click', (e) => {
            e.preventDefault();
            handleClearHistory();
             elements.historyDropdownContent.style.display = 'none';
             setTimeout(() => {
                 if (elements.historyDropdownContent) elements.historyDropdownContent.style.display = '';
             }, 100);
        });
    }
     if (elements.historyDropdownContent) {
         elements.historyDropdownContent.addEventListener('click', handleHistoryItemClick);
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

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); handleOpenFolderClick(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') { e.preventDefault(); if (!elements.exportProjectBtn?.disabled) handleExportClick(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'h') { e.preventDefault(); elements.historyBtn?.focus(); } // Focus to open dropdown
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
             if (isEditing && !elements.saveFileBtn?.disabled) {
                 e.preventDefault();
                 handleSaveFile();
             }
        }
        if (e.key === 'Escape' && isEditing) {
            disableEditing(true); // Revert changes on Escape
        }
     });
}

function handleShowError(title, message) {
    console.error(`Backend Error: ${title} - ${message}`);
    updateStatus(`Error: ${message}`, 'error', 5000);
}

async function handleOpenFolderClick() {
    console.log('[handleOpenFolderClick] Function called.');
    updateStatus('Opening folder dialog...', 'info');
    if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
         console.error("ERROR: window.electronAPI.invoke is not available! Check preload script.");
         updateStatus('Error: Preload script failed.', 'error');
         return;
    }

    try {
        const result = await window.electronAPI.invoke('dialog:openDirectory');
        console.log('[handleOpenFolderClick] Invoke result received:', JSON.stringify(result, null, 2));

        if (result && result.success === true && typeof result.data === 'string' && result.data.length > 0) {
            console.log(`[handleOpenFolderClick] Success! Path selected: ${result.data}`);
            await setActiveRepo(result.data);

        } else if (result && result.success === false && result.error && result.error.message) {
            console.error(`[handleOpenFolderClick] Failed (reported by main): ${result.error.message}`, result.error);
            updateStatus(`Failed to open: ${result.error.message}`, 'error', 5000);

        } else {
             if (result && result.success === true && result.data === null) {
                 console.log('[handleOpenFolderClick] Folder selection cancelled by user.');
                 updateStatus('Ready', 'info');
             } else {
                 console.warn('[handleOpenFolderClick] Result structure unexpected or failed without error message.', 'Received result:', result);
                 updateStatus('Folder selection failed or cancelled.', 'info');
             }
        }

    } catch (error) {
        console.error('[handleOpenFolderClick] CATCH BLOCK - Error during invoke/processing in renderer:', error);
        updateStatus(`Client-side error: ${error.message}`, 'error');
    }
}

async function setActiveRepo(repoPath) {
    if (!repoPath) {
        console.error("[setActiveRepo] Received empty repoPath. Aborting.");
        return;
    }
    repoPath = String(repoPath).replace(/[\\/]+$/, '');

    console.log(`[setActiveRepo] Setting active repo: ${repoPath}`);
    updateStatus(`Loading folder: ${repoPath}...`, 'info');

    addPathToHistory(repoPath);

    if (elements.repoRootNameSpan) {
        elements.repoRootNameSpan.textContent = repoPath.split(PATH_SEP_REGEX).pop() || repoPath;
        elements.repoRootNameSpan.title = repoPath;
    }
    currentRepoPath = repoPath;
    selectedFilePath = null;
    clearFileViewer();
    updateUIState();

    console.log(`[setActiveRepo] Invoking fs:readDirectoryStructure with currentRepoPath: "${currentRepoPath}"`);

    if (!currentRepoPath) {
         console.error("[setActiveRepo] CRITICAL: currentRepoPath became null/empty before invoke!");
         updateStatus('Internal Error: Path lost', 'error');
         return;
    }

    try {
        const result = await window.electronAPI.invoke('fs:readDirectoryStructure', currentRepoPath);
        console.log("[setActiveRepo] fs:readDirectoryStructure result received");

        if (result.success) {
            currentFileTree = result.data;

            if (elements.fileTreeContainer) {
                 elements.fileTreeContainer.innerHTML = '';
                 elements.fileTreeContainer.classList.remove('scan-results-container');
            } else {
                console.error("[setActiveRepo] Tree container element not found!");
                return;
            }

            if (currentFileTree && currentFileTree.children && currentFileTree.children.length > 0) {
                 currentFileTree.children.forEach(childNode => {
                    renderTree(childNode, elements.fileTreeContainer);
                 });
                 console.log("[setActiveRepo] Tree rendered successfully.");
            } else if (currentFileTree) {
                 elements.fileTreeContainer.innerHTML = '<p class="placeholder-text">Folder is empty or contains only ignored items.</p>';
                 console.log("[setActiveRepo] Rendered empty folder message.");
            } else {
                elements.fileTreeContainer.innerHTML = '<p class="placeholder-text error-text">Could not load folder data.</p>';
                 console.warn("[setActiveRepo] currentFileTree is null/undefined after successful invoke.", result.data);
            }

            updateStatus('Folder loaded.', 'success', 2000);
        } else {
            console.error('[setActiveRepo] Failed to read directory structure (IPC Error):', result.error);
            updateStatus(`Error loading folder: ${result.error?.message || 'Unknown error'}`, 'error');
            if (elements.fileTreeContainer) {
                elements.fileTreeContainer.innerHTML = `<p class="placeholder-text error-text">Error loading structure: ${escapeHtml(result.error?.message || 'Unknown error')}</p>`;
            }
        }
    } catch (error) {
        console.error('[setActiveRepo] CATCH BLOCK - Error during IPC invoke for fs:readDirectoryStructure:', error);
        updateStatus(`IPC Invoke Error: ${error.message}`, 'error');
         if (elements.fileTreeContainer) {
            elements.fileTreeContainer.innerHTML = `<p class="placeholder-text error-text">IPC Error loading structure: ${escapeHtml(error.message)}</p>`;
        }
    }
}

function renderTree(node, parentElement) {
    const treeNode = document.createElement('div');
    treeNode.className = 'tree-node';
    treeNode.dataset.path = node.path;
    treeNode.dataset.type = node.type;
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
        if (node.children && node.children.length > 0) {
             caret.innerHTML = '<i class="fas fa-caret-right"></i>';
        } else {
             caret.classList.add('placeholder');
        }
    } else {
        caret.classList.add('placeholder');
    }
    header.appendChild(caret);

    const icon = document.createElement('i');
    icon.className = 'tree-icon';
    if (node.type === 'directory') {
        icon.classList.add('folder', 'fas', 'fa-folder');
    } else if (node.type === 'file') {
        icon.classList.add('file', 'fas', 'fa-file');
    } else {
        icon.classList.add('file', 'fas', 'fa-link');
    }
    header.appendChild(icon);

    const content = document.createElement('span');
    content.className = 'tree-node-content';
    content.textContent = node.name;
    header.appendChild(content);

     if (node.error) {
        const errorIcon = document.createElement('i');
        errorIcon.className = 'tree-icon error-icon fas fa-exclamation-triangle';
        errorIcon.style.marginLeft = '5px';
        header.appendChild(errorIcon);
     }

    treeNode.appendChild(header);

    if (node.type === 'directory' && node.children && node.children.length > 0) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-node-children';
        node.children.forEach(child => {
            renderTree(child, childrenContainer);
        });
        treeNode.appendChild(childrenContainer);
    }

    parentElement.appendChild(treeNode);
}

function handleTreeClick(event) {
    const header = event.target.closest('.tree-node-header');

    if (!header || header.classList.contains('has-error')) {
        if (header && header.classList.contains('has-error')) {
             const nodeElement = header.closest('.tree-node');
             if (nodeElement && nodeElement.dataset.error) {
                 updateStatus(`Error: ${nodeElement.dataset.error}`, 'error', 4000);
             }
        }
        return;
    }

    const nodeElement = header.closest('.tree-node');
    if (!nodeElement) return;

    const path = nodeElement.dataset.path;
    const type = nodeElement.dataset.type;

    if (type === 'directory') {
        const childrenContainer = nodeElement.querySelector(':scope > .tree-node-children');
        const caret = header.querySelector('.tree-caret:not(.placeholder)');

        if (childrenContainer && caret) {
            const isExpanded = childrenContainer.classList.toggle('tree-node-children--expanded');
            caret.classList.toggle('tree-caret--expanded', isExpanded);
        }
    }

    if (type === 'file') {
        selectFile(path);
        elements.fileTreeContainer.querySelectorAll('.tree-node-header.selected').forEach(el => el.classList.remove('selected'));
        header.classList.add('selected');
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
    if (!currentRepoPath || elements.exportProjectBtn?.disabled) return;
    console.log('Starting project export...');
    updateStatus('Preparing export...', 'info');
    if (elements.exportProjectBtn) elements.exportProjectBtn.disabled = true;
    if (elements.exportProgressSpan) elements.exportProgressSpan.style.display = 'inline';
    if (elements.exportProgressSpan) elements.exportProgressSpan.textContent = '(Exporting...)';

    try {
        const result = await window.electronAPI.invoke('project:export', currentRepoPath);
        if (result.success) {
            updateStatus(result.data.message, 'success', 6000);
            console.log("Export successful:", result.data.message);
        } else {
            updateStatus(`Export failed: ${result.error.message}`, 'error', 6000);
            console.error('Export Failed:', result.error);
        }
    } catch (error) {
        console.error('IPC Error during export:', error);
        updateStatus(`Export IPC Error: ${error.message}`, 'error');
    } finally {
        if (elements.exportProjectBtn) elements.exportProjectBtn.disabled = !currentRepoPath;
        if (elements.exportProgressSpan) elements.exportProgressSpan.style.display = 'none';
    }
}

function updateUIState() {
    const repoLoaded = !!currentRepoPath;
    if (elements.exportProjectBtn) {
        elements.exportProjectBtn.disabled = !repoLoaded;
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

     const items = list.querySelectorAll('a:not(#clear-history-link)');
     items.forEach(item => item.remove());
     const hr = list.querySelector('hr');
     const placeholder = list.querySelector('.placeholder-text');

     if (placeholder) placeholder.style.display = (history?.length ?? 0) === 0 ? 'block' : 'none';
     if (hr) hr.style.display = (history?.length ?? 0) === 0 ? 'none' : 'block';

     if (history && history.length > 0) {
         history.forEach(repoPath => {
             const listItem = document.createElement('a');
             listItem.href = '#';
             listItem.dataset.path = repoPath;
             listItem.textContent = repoPath.split(PATH_SEP_REGEX).pop() || repoPath;
             listItem.title = repoPath;
             if (hr) {
                  list.insertBefore(listItem, hr);
             } else {
                  list.appendChild(listItem);
             }
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
         } else {
             console.error("Failed to clear history (IPC):", result.error);
             updateStatus('Error clearing history.', 'error');
         }
     } catch (error) {
         console.error("Failed to clear history (Catch):", error);
         updateStatus('Error clearing history.', 'error');
     }
 }

 function handleHistoryItemClick(event) {
     event.preventDefault();
     const target = event.target.closest('a[data-path]');
     if (target && target.dataset.path) {
         const repoPath = target.dataset.path;
         console.log(`History item clicked: ${repoPath}`);
         setActiveRepo(repoPath);

         if (elements.historyDropdownContent) {
              elements.historyDropdownContent.style.display = 'none';
             setTimeout(() => {
                  if (elements.historyDropdownContent) elements.historyDropdownContent.style.display = '';
             }, 150);
         }
     }
 }

async function handleScanDirsClick() {
    console.log('Scan Dirs button clicked.');
    updateStatus('Selecting home directory...', 'info');
    try {
        const homeDirResult = await window.electronAPI.invoke('dialog:selectHomeDirectory');
         if (homeDirResult.success && homeDirResult.data) {
             const homePath = homeDirResult.data;
             updateStatus(`Scanning ${homePath} for repositories...`, 'info');
             const findResult = await window.electronAPI.invoke('fs:findRepositories', homePath);
             if (findResult.success) {
                 displayScanResults(findResult.data);
             } else {
                 console.error("Failed to find repositories:", findResult.error);
                 updateStatus(`Scan failed: ${findResult.error.message}`, 'error');
             }
         } else if (homeDirResult.success && !homeDirResult.data) {
            updateStatus('Scan cancelled.', 'info');
         } else {
            console.error("Failed to select home directory:", homeDirResult.error);
            updateStatus(`Error selecting directory: ${homeDirResult.error.message}`, 'error');
         }
    } catch (error) {
        console.error("Error during repository scan:", error);
        updateStatus(`Scan error: ${error.message}`, 'error');
    }
}

function displayScanResults(repoPaths) {
    if (!repoPaths || repoPaths.length === 0) {
        updateStatus('No repositories found in the selected directory.', 'info', 4000);
        return;
    }

    updateStatus(`Found ${repoPaths.length} potential repositories. Displaying...`, 'success', 3000);

    if (elements.fileTreeContainer) {
        elements.fileTreeContainer.innerHTML = '';
        elements.fileTreeContainer.classList.add('scan-results-container');

        const list = document.createElement('ul');
        repoPaths.forEach(repoPath => {
            const item = document.createElement('li');
            item.textContent = repoPath.split(PATH_SEP_REGEX).pop() || repoPath;
            item.title = `Click to open ${repoPath}`;
            item.dataset.path = repoPath;
            item.addEventListener('click', () => {
                elements.fileTreeContainer.classList.remove('scan-results-container');
                setActiveRepo(repoPath);
            });
            list.appendChild(item);
        });
        elements.fileTreeContainer.appendChild(list);
        if (elements.repoRootNameSpan) elements.repoRootNameSpan.textContent = "Scan Results";
        clearFileViewer();
    }
    console.log("Found Repositories:", repoPaths);
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

     // Restore status only if not currently showing an error/success message briefly
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

             // Update the display view as well after saving & re-highlight
             elements.fileContentDisplay.textContent = newContent; // Use textContent first
             if (window.hljs && typeof window.hljs.highlightElement === 'function') {
                try {
                    window.hljs.highlightElement(elements.fileContentDisplay);
                } catch (e) {
                    console.warn(`Highlighting after save failed:`, e);
                     elements.fileContentDisplay.innerHTML = escapeHtml(newContent); // Fallback if highlight fails
                }
            } else {
                 elements.fileContentDisplay.innerHTML = escapeHtml(newContent); // Fallback if hljs unavailable
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