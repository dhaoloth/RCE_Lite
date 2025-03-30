const fs = require('fs'); // Use non-promise fs for streaming if needed later
const fsp = require('fs/promises');
const path = require('path');

/**
 * Validates if a path exists and is a directory. Throws error if not.
 */
async function validateDirectory(dirPath) {
    if (!dirPath) throw new Error("Path is required.");
    try {
        const stats = await fsp.stat(dirPath);
        if (!stats.isDirectory()) {
            throw new Error(`Path is not a directory: ${dirPath}`);
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Directory not found: ${dirPath}`);
        }
        throw error; // Re-throw other errors (permissions etc.)
    }
}

/**
 * Recursively reads directory structure.
 * Filters out ignored items and includes only specified file types if needed.
 */
// --- Replace the existing getDirectoryStructureRecursive function ---

async function getDirectoryStructureRecursive(dirPath, options = {}, currentDepth = 0) {
    console.log(`[fileUtils:getDirectoryStructureRecursive] Processing: "${dirPath}" (Depth: ${currentDepth})`); // Log entry
    const { maxDepth = 15, ignoredItemsSet = new Set(['.git', 'node_modules']) } = options;

    if (currentDepth > maxDepth) {
        console.warn(`[fileUtils:getDirectoryStructureRecursive] Max depth (${maxDepth}) reached for "${dirPath}"`);
        return { name: path.basename(dirPath), path: dirPath, type: 'directory', error: 'Max depth reached', children: [] };
    }

    const name = path.basename(dirPath);
    const structure = { name, path: dirPath, type: 'directory', children: [] };

    let dirents;
    try {
        // Ensure path exists and is directory before reading (optional but good practice)
        const stats = await fsp.stat(dirPath);
        if (!stats.isDirectory()) {
             console.error(`[fileUtils:getDirectoryStructureRecursive] Path is not a directory: "${dirPath}"`);
             structure.error = 'Path is not a directory';
             return structure;
        }
        dirents = await fsp.readdir(dirPath, { withFileTypes: true });
        // console.log(`[fileUtils:getDirectoryStructureRecursive] Successfully read ${dirents.length} items in "${dirPath}"`); // Verbose log

    } catch (readdirError) {
        // *** Log the critical error ***
        console.error(`[fileUtils:getDirectoryStructureRecursive] CRITICAL: Cannot read directory "${dirPath}": ${readdirError.message}`, readdirError.code); // Log the critical error + code
        structure.error = `Cannot read directory: ${readdirError.code || readdirError.message}`;
        // Return the structure with the error attached, DON'T THROW here
        return structure;
    }

    const childProcessingPromises = [];

    for (const dirent of dirents) {
        const itemName = dirent.name;
        const itemPath = path.join(dirPath, itemName);

        if (ignoredItemsSet.has(itemName.toLowerCase())) {
            // console.log(`[fileUtils:getDirectoryStructureRecursive] Ignoring item: "${itemPath}"`);
            continue; // Skip ignored items
        }

        // Process each item asynchronously
        const processItem = async () => {
            let childNode = null;
            try {
                if (dirent.isDirectory()) {
                    childNode = await getDirectoryStructureRecursive(itemPath, options, currentDepth + 1);
                } else if (dirent.isFile()) {
                    childNode = { name: itemName, path: itemPath, type: 'file' };
                } else if (dirent.isSymbolicLink()) {
                    childNode = { name: itemName, path: itemPath, type: 'symlink' };
                    try {
                        childNode.target = await fsp.readlink(itemPath);
                    } catch (linkErr) {
                        console.warn(`[fileUtils:getDirectoryStructureRecursive] Cannot read link "${itemPath}": ${linkErr.message}`);
                        childNode.error = `Cannot read link: ${linkErr.code || linkErr.message}`;
                    }
                }
                 // Ignore other types silently for now
            } catch (itemError) {
                 console.error(`[fileUtils:getDirectoryStructureRecursive] Error processing item "${itemPath}": ${itemError.message}`);
                 // Create an error node to show in the tree
                 childNode = { name: itemName, path: itemPath, type: 'error', error: `Processing error: ${itemError.message}` };
            }
            return childNode;
        };
        childProcessingPromises.push(processItem());

    } // End of for loop

    // Wait for all children to be processed
    const resolvedChildren = await Promise.all(childProcessingPromises);

    // Filter out nulls (which shouldn't happen now) and assign valid children
    structure.children = resolvedChildren.filter(child => child !== null);

    // Sort children: directories first, then by name
    structure.children.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        const nameA = a.name || ''; // Handle potential error nodes without names
        const nameB = b.name || '';
        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });

    // console.log(`[fileUtils:getDirectoryStructureRecursive] Finished processing: "${dirPath}"`); // Verbose log
    return structure;
}

// --- Ensure readFileContent and others are still exported ---
module.exports = {
    validateDirectory,
    getDirectoryStructureRecursive,
    readFileContent,
    exportProjectToString,
};


/**
 * Reads file content, attempting UTF-8 and handling common errors.
 */
async function readFileContent(filePath) {
    if (!filePath) throw new Error("File path is required.");
    let stats;
    try {
        stats = await fsp.stat(filePath);
        if (stats.isDirectory()) throw new Error("Path is a directory.");
        // Add a reasonable size limit for viewing
        const maxSize = 2 * 1024 * 1024; // 2MB limit for viewing
        if (stats.size > maxSize) {
            throw new Error(`File too large to view (${formatBytes(stats.size)}, max ${formatBytes(maxSize)}).`);
        }
        if (stats.size === 0) return ""; // Return empty string for empty files
    } catch (error) {
        if (error.code === 'ENOENT') throw new Error(`File not found: ${filePath}`);
        throw error; // Re-throw others
    }

    try {
        // Attempt to read as UTF-8
        const content = await fsp.readFile(filePath, 'utf-8');
        // Basic check for null bytes which often indicate binary files
        if (content.includes('\u0000')) {
            throw new Error("File appears to be binary or has unsupported encoding.");
        }
        return content;
    } catch (error) {
        if (error.code === 'EACCES') throw new Error(`Permission denied reading file: ${filePath}`);
        // Catch errors from reading non-UTF8 as UTF8
        if (error instanceof TypeError && error.message.includes('ERR_INVALID_CHAR')) {
            throw new Error("Cannot display file: Likely binary or unsupported text encoding.");
        }
        console.warn(`Failed reading ${filePath} as utf-8: ${error.message}`);
        throw new Error(`Could not read file content. It might be binary or have an unsupported encoding.`);
    }
}


/**
 * Recursively walks the directory and concatenates allowed file contents into a single string.
 */
async function exportProjectToString(basePath, savePath, allowedExtensions = [], ignoredItems = []) {
    const ignoredItemsSet = new Set(ignoredItems.map(item => item.toLowerCase()));
    const allowedExtSet = new Set(allowedExtensions.map(ext => ext.toLowerCase()));
    const outputFilePath = savePath; // Use the path provided by the user
    let filesProcessed = 0;
    let filesSkipped = 0;
    let totalBytes = 0;
    const maxSizePerFile = 5 * 1024 * 1024; // 5MB limit per file for export

    // Use a write stream for better performance with large outputs
    const outputStream = fs.createWriteStream(outputFilePath, { encoding: 'utf8' });

    // Helper function for recursive traversal
    async function walkDir(currentPath) {
        let dirents;
        try {
            dirents = await fsp.readdir(currentPath, { withFileTypes: true });
        } catch (err) {
            console.warn(`Skipping directory ${currentPath}: ${err.message}`);
            filesSkipped++; // Count directory skip
            outputStream.write(`\n--- Error reading directory: ${currentPath} (${err.message}) ---\n`);
            return;
        }

        for (const dirent of dirents) {
            const itemName = dirent.name;
            const itemPath = path.join(currentPath, itemName);

            // Skip ignored items (case-insensitive)
            if (ignoredItemsSet.has(itemName.toLowerCase())) {
                console.log(`Ignoring item: ${itemPath}`);
                continue;
            }

            if (dirent.isDirectory()) {
                await walkDir(itemPath); // Recurse
            } else if (dirent.isFile()) {
                const fileExt = path.extname(itemName).toLowerCase();
                const fileNameLower = itemName.toLowerCase();

                // Check if file should be included based on extension or specific names
                const isAllowedExt = allowedExtSet.has(fileExt);
                // Check for specific allowed names (like Dockerfile, .gitignore) even without extension
                const isAllowedName = allowedExtensions.includes(fileNameLower);

                if (isAllowedExt || isAllowedName) {
                    try {
                        const stats = await fsp.stat(itemPath);
                        if (stats.size > maxSizePerFile) {
                            console.warn(`Skipping large file (${formatBytes(stats.size)}): ${itemPath}`);
                            filesSkipped++;
                            outputStream.write(`\n--- Skipped large file: ${itemPath} (${formatBytes(stats.size)}) ---\n`);
                            continue;
                        }
                        if (stats.size === 0) {
                             console.log(`Including empty file: ${itemPath}`);
                             // Optionally skip empty files? For now, include header.
                        }

                        const content = await fsp.readFile(itemPath, 'utf-8');

                        // Check for binary content again (more robust check needed ideally)
                        if (content.includes('\u0000')) {
                             console.warn(`Skipping likely binary file: ${itemPath}`);
                             filesSkipped++;
                             outputStream.write(`\n--- Skipped binary file: ${itemPath} ---\n`);
                             continue;
                        }

                        // Format for LLM
                        const relativePath = path.relative(basePath, itemPath).replace(/\\/g, '/'); // Use relative path
                        const separatorStart = `\n--- File: ${relativePath} ---\n`;
                        const separatorEnd = `\n--- End File: ${relativePath} ---\n`;
                        const codeBlockStart = '```' + (fileExt.substring(1) || '') + '\n'; // Add language hint
                        const codeBlockEnd = '\n```';

                        outputStream.write(separatorStart);
                        outputStream.write(codeBlockStart);
                        outputStream.write(content);
                        outputStream.write(codeBlockEnd);
                        outputStream.write(separatorEnd);

                        filesProcessed++;
                        totalBytes += stats.size;

                    } catch (readErr) {
                        console.warn(`Skipping file ${itemPath} due to read error: ${readErr.message}`);
                        filesSkipped++;
                        outputStream.write(`\n--- Error reading file: ${itemPath} (${readErr.message}) ---\n`);
                    }
                } else {
                    // console.log(`Skipping file with disallowed extension: ${itemPath}`); // Can be noisy
                    filesSkipped++;
                }
            }
            // Ignore symlinks, sockets, etc. for export
        }
    }

    // Start the walk and wait for it to finish
    await walkDir(basePath);

    // Close the stream and wait for it to finish writing
    await new Promise((resolve, reject) => {
        outputStream.end((err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    console.log(`Export complete. Processed: ${filesProcessed}, Skipped: ${filesSkipped}, Total Size: ${formatBytes(totalBytes)}`);
    return `Processed: ${filesProcessed} files, Skipped: ${filesSkipped}, Total Size: ${formatBytes(totalBytes)}.`;
}

// Helper to format bytes
function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}


module.exports = {
    validateDirectory,
    getDirectoryStructureRecursive,
    readFileContent,
    exportProjectToString,
};