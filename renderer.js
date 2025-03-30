// Global state
let currentRepoPath = null;
let currentFileTree = null;
let selectedFilePath = null;

// Removed unused settings/versions variables

// Regular expression to split paths cross-platform
const PATH_SEP_REGEX = /[\\/]/;

// DOM Element References
const elements = {
    openFolderBtn: document.getElementById('open-folder-btn'),
    exportProjectBtn: document.getElementById('export-project-btn'),
    fileTreeContainer: document.getElementById('file-tree'),
    repoRootNameSpan: document.getElementById('repo-root-name'),
    fileViewerHeader: document.getElementById('viewer-header'),
    viewedFilePathSpan: document.getElementById('viewed-file-path'),
    fileContentElement: document.getElementById('file-content'),
    viewerPlaceholder: document.getElementById('viewer-placeholder'),
    statusBar: document.getElementById('status-bar'),
    statusMessageSpan: document.getElementById('status-message'),
    exportProgressSpan: document.getElementById('export-progress'),
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('Renderer DOMContentLoaded');
    setupEventListeners();
    updateUIState(); // Initial UI state (buttons disabled etc.)
});

// --- Event Listeners Setup ---
function setupEventListeners() {
    // IPC Listeners (from Main)
    // window.electronAPI.on('initial-data-loaded', handleInitialData); // Removed - Not used
    window.electronAPI.on('set-active-repo', setActiveRepo);      // Set repo from main (e.g., on load)
    window.electronAPI.on('show-error', handleShowError);         // Display errors from main
    window.electronAPI.on('trigger-open-folder', handleOpenFolderClick); // Menu action
    window.electronAPI.on('trigger-export-project', handleExportClick); // Menu action

    // UI Listeners
    if (elements.openFolderBtn) {
        elements.openFolderBtn.addEventListener('click', handleOpenFolderClick);
        console.log("DEBUG: Attached click listener to Open Folder button."); // Confirmation Log
    } else {
        console.error("ERROR: Open Folder button element not found in DOM!");
    }
    if (elements.exportProjectBtn) {
        elements.exportProjectBtn.addEventListener('click', handleExportClick);
    }
    if (elements.fileTreeContainer) {
        // Use event delegation for tree items
        elements.fileTreeContainer.addEventListener('click', handleTreeClick);
    }
     // Global key listeners (optional)
     document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'o') { handleOpenFolderClick(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') { if(!elements.exportProjectBtn?.disabled) handleExportClick(); }
     });
}

// --- IPC Handlers ---
// function handleInitialData(...) { ... } // Removed - Not used

function handleShowError(title, message) {
    console.error(`Backend Error: ${title} - ${message}`);
    updateStatus(`Error: ${message}`, 'error', 5000);
    // Could show a more prominent modal if desired
}

// --- Core Logic ---

async function handleOpenFolderClick() {
    console.log('[handleOpenFolderClick] Function called.'); // Log 1: Function start
    updateStatus('Opening folder dialog...', 'info');
    if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
         console.error("ERROR: window.electronAPI.invoke is not available! Check preload script.");
         updateStatus('Error: Preload script failed.', 'error');
         return;
    }

    try {
        console.log("[handleOpenFolderClick] Trying to invoke 'dialog:openDirectory'..."); // Log 2: Before invoke
        const result = await window.electronAPI.invoke('dialog:openDirectory');

        // Log 3: Log the raw result object immediately after invoke returns
        console.log('[handleOpenFolderClick] Invoke result received:', JSON.stringify(result, null, 2));

        // === Check 1: Successful Path Received ===
        // Ensure result exists, success is true, and data is a non-empty string
        if (result && result.success === true && typeof result.data === 'string' && result.data.length > 0) {
            console.log(`[handleOpenFolderClick] Success! Path selected: ${result.data}`); // Log 4a: Success path
            await setActiveRepo(result.data); // Call next step

        // === Check 2: Explicit Failure from Main Process ===
        // Ensure result exists, success is false, and there's an error object
        } else if (result && result.success === false && result.error && result.error.message) {
            console.error(`[handleOpenFolderClick] Failed (reported by main): ${result.error.message}`, result.error); // Log 4b: Failure message
            updateStatus(`Failed to open: ${result.error.message}`, 'error', 5000);

        // === Check 3: Cancellation or Other Unsuccessful Cases ===
        // This catches cases like:
        // - User cancelled the dialog (main might return { success: true, data: null } or { success: false } depending on implementation)
        // - Main process returned an unexpected structure
        } else {
             // Check specifically for cancellation which we expect to be { success: true, data: null }
             if (result && result.success === true && result.data === null) {
                 console.log('[handleOpenFolderClick] Folder selection cancelled by user.'); // Log 4c-1: Cancellation
                 updateStatus('Ready', 'info'); // Reset status
             } else {
                 console.warn('[handleOpenFolderClick] Result structure unexpected or failed without error message.', 'Received result:', result); // Log 4c-2: Other unexpected
                 updateStatus('Folder selection failed or cancelled.', 'info');
             }
        }

    } catch (error) {
        // This catches errors *in the renderer* during the invoke call itself (e.g., channel not found) or during await/processing
        console.error('[handleOpenFolderClick] CATCH BLOCK - Error during invoke/processing in renderer:', error); // Log 5: Renderer error
        updateStatus(`Client-side error: ${error.message}`, 'error');
    }
}


async function setActiveRepo(repoPath) {
    if (!repoPath) {
        console.error("[setActiveRepo] Received empty repoPath. Aborting.");
        return;
    }
    // Make sure repoPath is treated as a string
    repoPath = String(repoPath).replace(/[\\/]+$/, ''); // Normalize path, ensure it's string

    console.log(`[setActiveRepo] Setting active repo: ${repoPath}`); // Log the path being set
    updateStatus(`Loading folder: ${repoPath}...`, 'info');

    if (elements.repoRootNameSpan) {
        elements.repoRootNameSpan.textContent = repoPath.split(PATH_SEP_REGEX).pop() || repoPath;
        elements.repoRootNameSpan.title = repoPath;
    }
    // --- Set the global variable ---
    currentRepoPath = repoPath;
    // -----------------------------
    selectedFilePath = null; // Clear file selection
    clearFileViewer();
    updateUIState(); // Enable export button etc.

    // --- Verify currentRepoPath just before invoking ---
    console.log(`[setActiveRepo] Invoking fs:readDirectoryStructure with currentRepoPath: "${currentRepoPath}" (Type: ${typeof currentRepoPath})`);

    if (!currentRepoPath) {
         console.error("[setActiveRepo] CRITICAL: currentRepoPath became null/empty before invoke!");
         updateStatus('Internal Error: Path lost', 'error');
         return;
    }
    // ---------------------------------------------------


    try {
        // --- Ensure the correct variable is passed HERE ---
        const result = await window.electronAPI.invoke('fs:readDirectoryStructure', currentRepoPath);
        // -----------------------------------------------

        console.log("[setActiveRepo] fs:readDirectoryStructure result:", JSON.stringify(result, null, 2)); // Log the result

        if (result.success) {
            currentFileTree = result.data; // This is the root node object

            // Clear previous tree
            if (elements.fileTreeContainer) {
                elements.fileTreeContainer.innerHTML = '';
            } else {
                console.error("[setActiveRepo] Tree container element not found!");
                return; // Cannot render
            }

            // Check if the root node (returned data) exists and has children
            if (currentFileTree && currentFileTree.children && currentFileTree.children.length > 0) {
                 // Render each child of the root directory into the container
                 currentFileTree.children.forEach(childNode => {
                    renderTree(childNode, elements.fileTreeContainer); // Call new render function
                 });
                 console.log("[setActiveRepo] Tree rendered successfully.");
            } else if (currentFileTree) {
                 // Handle empty directory case
                 elements.fileTreeContainer.innerHTML = '<p class="placeholder-text">Folder is empty or contains only ignored items.</p>';
                 console.log("[setActiveRepo] Rendered empty folder message.");
            } else {
                // Handle case where data is unexpectedly null/undefined
                elements.fileTreeContainer.innerHTML = '<p class="placeholder-text error-text">Could not load folder data (Result data null/undefined).</p>';
                 console.warn("[setActiveRepo] currentFileTree is null/undefined after successful invoke.", result.data);
            }

            updateStatus('Folder loaded.', 'success', 2000);
        } else { // Handle failure from IPC for fs:readDirectoryStructure
            console.error('[setActiveRepo] Failed to read directory structure (IPC Error):', result.error);
            updateStatus(`Error loading folder: ${result.error?.message || 'Unknown error'}`, 'error'); // Use optional chaining
            if (elements.fileTreeContainer) {
                elements.fileTreeContainer.innerHTML = `<p class="placeholder-text error-text">Error loading structure: ${escapeHtml(result.error?.message || 'Unknown error')}</p>`;
            }
        }
    } catch (error) { // Handle error during IPC invoke itself
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
    // Add data attributes needed by handleTreeClick to the node itself might be easier
    treeNode.dataset.path = node.path;
    treeNode.dataset.type = node.type;
    if (node.error) {
        treeNode.dataset.error = node.error;
        treeNode.title = node.error; // Tooltip for error
    }


    // --- Header (Clickable Row) ---
    const header = document.createElement('div');
    header.className = 'tree-node-header';
    if (node.error) {
        header.classList.add('has-error');
    }

    // --- Caret (Toggle) or Placeholder ---
    const caret = document.createElement('div');
    caret.className = 'tree-caret';
    if (node.type === 'directory') {
        // Only add icon if there are children to expand/collapse
        if (node.children && node.children.length > 0) {
             caret.innerHTML = '<i class="fas fa-caret-right"></i>';
        } else {
             caret.classList.add('placeholder'); // Keep space for alignment
        }
    } else {
        caret.classList.add('placeholder'); // Keep space for alignment
    }
    header.appendChild(caret);

    // --- Icon ---
    const icon = document.createElement('i');
    icon.className = 'tree-icon'; // Base class
    if (node.type === 'directory') {
        icon.classList.add('folder', 'fas', 'fa-folder');
    } else if (node.type === 'file') {
        icon.classList.add('file', 'fas', 'fa-file');
    } else { // symlink, other...
        icon.classList.add('file', 'fas', 'fa-link'); // Example for symlink
    }
    header.appendChild(icon);

    // --- Content (Name) ---
    const content = document.createElement('span');
    content.className = 'tree-node-content';
    content.textContent = node.name;
    header.appendChild(content);

    // --- Error Icon (if applicable) ---
     if (node.error) {
        const errorIcon = document.createElement('i');
        errorIcon.className = 'tree-icon error-icon fas fa-exclamation-triangle';
        errorIcon.style.marginLeft = '5px'; // Add some space
        header.appendChild(errorIcon);
     }

    // Add header to the node container
    treeNode.appendChild(header);


    // --- Children ---
    if (node.type === 'directory' && node.children && node.children.length > 0) {
        const childrenContainer = document.createElement('div');
        // Start collapsed
        childrenContainer.className = 'tree-node-children';

        node.children.forEach(child => {
            renderTree(child, childrenContainer); // Recursive call
        });
        treeNode.appendChild(childrenContainer);
    }

    parentElement.appendChild(treeNode);
}

// --- New handleTreeClick (Replaces old one) ---
// Uses event delegation on the main tree container

function handleTreeClick(event) {
    // Find the header element that was clicked on, or inside of
    const header = event.target.closest('.tree-node-header');

    // Ignore clicks outside of headers or on error items
    if (!header || header.classList.contains('has-error')) {
        if (header && header.classList.contains('has-error')) {
             // Optionally show error message from title or data attribute
             const nodeElement = header.closest('.tree-node');
             if (nodeElement && nodeElement.dataset.error) {
                 updateStatus(`Error: ${nodeElement.dataset.error}`, 'error', 4000);
             }
        }
        return;
    }

    const nodeElement = header.closest('.tree-node');
    if (!nodeElement) return; // Should not happen if header exists

    const path = nodeElement.dataset.path;
    const type = nodeElement.dataset.type;

    // Toggle Expansion for Directories
    if (type === 'directory') {
        const childrenContainer = nodeElement.querySelector(':scope > .tree-node-children');
        const caret = header.querySelector('.tree-caret:not(.placeholder)'); // Find the actual caret

        if (childrenContainer && caret) { // Check if it's expandable
            const isExpanded = childrenContainer.classList.toggle('tree-node-children--expanded');
            caret.classList.toggle('tree-caret--expanded', isExpanded);
        }
        // Note: We don't select directories in this app currently
    }

    // Select File
    if (type === 'file') {
        selectFile(path); // Call your existing function

        // Update selection style
        elements.fileTreeContainer.querySelectorAll('.tree-node-header.selected').forEach(el => el.classList.remove('selected'));
        header.classList.add('selected');
    }
}


async function selectFile(filePath) {
    if (!filePath) return;
    console.log(`Selecting file: ${filePath}`);
    selectedFilePath = filePath;
    clearFileViewer(); // Clear previous content and show placeholder
    const filename = filePath.split(PATH_SEP_REGEX).pop();
    updateStatus(`Loading file: ${filename}`, 'info');

    if (elements.viewedFilePathSpan) {
        // Ensure currentRepoPath ends with a separator for clean replacement
        const repoPathWithSep = currentRepoPath.endsWith('/') || currentRepoPath.endsWith('\\')
            ? currentRepoPath
            : currentRepoPath + (currentRepoPath.includes('/') ? '/' : '\\');
        elements.viewedFilePathSpan.textContent = filePath.replace(repoPathWithSep, ''); // Show relative path
        elements.viewedFilePathSpan.title = filePath; // Show full path on hover
    }
    if (elements.viewerPlaceholder) elements.viewerPlaceholder.classList.add('hidden'); // Hide placeholder
    if (!elements.fileContentElement) {
         console.error("File content element not found!");
         updateStatus('UI Error: Cannot display file', 'error');
         return;
    }

    try {
        console.log(`Invoking fs:readFileContent for: ${filePath}`);
        const result = await window.electronAPI.invoke('fs:readFileContent', filePath);
        console.log('fs:readFileContent result:', result); // Log the raw result

        if (result.success) {
            const content = result.data;
            console.log(`File content loaded successfully (${content.length} chars). Highlighting...`);

            let highlightedCode = escapeHtml(content); // Default to escaped content

            // --- Add Robust Check for hljs ---
            if (window.hljs && typeof window.hljs.getLanguage === 'function' && typeof window.hljs.highlight === 'function') {
                // Determine language based on extension (basic)
                const extension = filePath.split('.').pop()?.toLowerCase() || '';
                let detectedLanguage = window.hljs.getLanguage(extension) ? extension : null;

                // Fallback for common languages if direct extension match fails
                if (!detectedLanguage) {
                     if (['js', 'jsx', 'mjs', 'cjs'].includes(extension)) detectedLanguage = 'javascript';
                     else if (['ts', 'tsx'].includes(extension)) detectedLanguage = 'typescript';
                     else if (['py'].includes(extension)) detectedLanguage = 'python';
                     else if (['java'].includes(extension)) detectedLanguage = 'java';
                     else if (['html', 'htm', 'xml'].includes(extension)) detectedLanguage = 'xml';
                     else if (['css', 'scss', 'sass', 'less'].includes(extension)) detectedLanguage = 'css';
                     else if (['json'].includes(extension)) detectedLanguage = 'json';
                     else if (['md'].includes(extension)) detectedLanguage = 'markdown';
                     else if (['sh', 'bash', 'zsh'].includes(extension)) detectedLanguage = 'bash';
                     else if (['gitignore', 'npmrc', 'editorconfig'].includes(filename.toLowerCase())) detectedLanguage = 'plaintext'; // Treat common dotfiles as text
                     else if (['dockerfile', 'makefile'].includes(filename.toLowerCase())) detectedLanguage = 'makefile'; // Or 'dockerfile' if specific lang exists
                     // Add more fallbacks as needed
                }


                if (detectedLanguage) {
                    console.log(`Attempting highlight with language: ${detectedLanguage}`);
                    try {
                        // Use highlight function directly via window object
                        highlightedCode = window.hljs.highlight(content, { language: detectedLanguage, ignoreIllegals: true }).value; // Added window.
                        console.log("Highlighting successful.");
                    } catch (e) {
                        console.warn(`Highlighting error for ${detectedLanguage}, falling back to plain text:`, e);
                        // highlightedCode is already set to escapedHtml(content)
                    }
                } else {
                    console.log("No specific language detected, displaying plain text.");
                     // highlightedCode is already set to escapedHtml(content)
                }
            } else {
                // --- Log error if hljs is not ready ---
                console.error("Highlight.js (hljs) not available or not fully loaded yet.");
                // Keep highlightedCode as escapedHtml(content)
            }
            // --- End of hljs check ---


            elements.fileContentElement.innerHTML = highlightedCode; // Set the potentially HTML content
            updateStatus(`File loaded: ${filename}`, 'success', 2000);

        } else { // Handle read file failure
             console.error(`Failed to read file content:`, result.error);
             elements.fileContentElement.innerHTML = `<span class="error-text">Error loading file: ${escapeHtml(result.error?.message || 'Unknown error')}</span>`;
             updateStatus(`Error loading file: ${filename}`, 'error');
        }
    } catch (error) { // Handle IPC error
        // Check if the error message indicates hljs issue from IPC itself (less likely now)
         if (error && error.message && error.message.includes('hljs is not defined')) {
             console.error("IPC Error likely related to hljs initialization timing:", error);
             elements.fileContentElement.innerHTML = `<span class="error-text">Error initializing highlighter. Please try selecting the file again.</span>`;
             updateStatus(`Error initializing highlighter`, 'error');
         } else {
            console.error(`IPC Error reading file "${filePath}":`, error);
            if (elements.fileContentElement) {
                elements.fileContentElement.innerHTML = `<span class="error-text">IPC Error: ${escapeHtml(error.message)}</span>`;
            }
            updateStatus(`IPC Error loading file`, 'error');
         }
    }
}

function clearFileViewer() {
    if (elements.fileContentElement) elements.fileContentElement.innerHTML = '';
    if (elements.viewedFilePathSpan) elements.viewedFilePathSpan.textContent = 'Select a file to view';
    if (elements.viewerPlaceholder) elements.viewerPlaceholder.classList.remove('hidden');
    selectedFilePath = null;
}

// --- Export Logic ---
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
            // Need a way to show errors more prominently if desired
            updateStatus(`Export failed: ${result.error.message}`, 'error', 6000);
            console.error('Export Failed:', result.error); // Log full error
             // Placeholder for a more user-facing error display if needed later
             // showErrorModal('Export Failed', result.error);
        }
    } catch (error) {
        console.error('IPC Error during export:', error);
        updateStatus(`Export IPC Error: ${error.message}`, 'error');
        // Placeholder for a more user-facing error display if needed later
        // showErrorModal('Export Communication Error', error);
    } finally {
        if (elements.exportProjectBtn) elements.exportProjectBtn.disabled = !currentRepoPath; // Re-enable based on repo path
        if (elements.exportProgressSpan) elements.exportProgressSpan.style.display = 'none';
    }
}


// --- UI State & Helpers ---
function updateUIState() {
    // Enable/disable buttons based on whether a repo is loaded
    const repoLoaded = !!currentRepoPath;
    if (elements.exportProjectBtn) {
        elements.exportProjectBtn.disabled = !repoLoaded;
    }
    // Add other UI state updates here if needed
}

function escapeHtml(unsafe) {
    return unsafe.replace(/&/g, "&amp;")
                 .replace(/</g, "&lt;")
                 .replace(/>/g, "&gt;")
                 .replace(/"/g, "&quot;")
                 .replace(/'/g, "&#39;");
}

let statusTimeout;
function updateStatus(message, type = 'info', duration = null) {
    if (!elements.statusMessageSpan) return;
    clearTimeout(statusTimeout);
    elements.statusMessageSpan.textContent = message;
    elements.statusMessageSpan.className = `status-message ${type}`; // Use type as class directly
    if (duration) {
        statusTimeout = setTimeout(() => {
            if (elements.statusMessageSpan.textContent === message) { // Avoid clearing newer messages
                 elements.statusMessageSpan.textContent = 'Ready';
                 elements.statusMessageSpan.className = 'status-message';
            }
        }, duration);
    }
}

// Removed populateVersionInfo as it's not used