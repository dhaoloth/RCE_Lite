const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

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
        throw error;
    }
}

async function getDirectoryStructureRecursive(dirPath, options = {}, currentDepth = 0) {
    const { maxDepth = 15, ignoredItemsSet = new Set(['.git', 'node_modules']) } = options;

    if (currentDepth > maxDepth) {
        console.warn(`[fileUtils:getDirectoryStructureRecursive] Max depth (${maxDepth}) reached for "${dirPath}"`);
        return { name: path.basename(dirPath), path: dirPath, type: 'directory', error: 'Max depth reached', children: [] };
    }

    const name = path.basename(dirPath);
    const structure = { name, path: dirPath, type: 'directory', children: [] };

    let dirents;
    try {
        const stats = await fsp.stat(dirPath);
        if (!stats.isDirectory()) {
             structure.error = 'Path is not a directory';
             return structure;
        }
        dirents = await fsp.readdir(dirPath, { withFileTypes: true });

    } catch (readdirError) {
        console.error(`[fileUtils:getDirectoryStructureRecursive] CRITICAL: Cannot read directory "${dirPath}": ${readdirError.message}`, readdirError.code);
        structure.error = `Cannot read directory: ${readdirError.code || readdirError.message}`;
        return structure;
    }

    const childProcessingPromises = [];

    for (const dirent of dirents) {
        const itemName = dirent.name;
        const itemPath = path.join(dirPath, itemName);

        if (ignoredItemsSet.has(itemName.toLowerCase())) {
            continue;
        }

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
                        childNode.error = `Cannot read link: ${linkErr.code || linkErr.message}`;
                    }
                }
            } catch (itemError) {
                 childNode = { name: itemName, path: itemPath, type: 'error', error: `Processing error: ${itemError.message}` };
            }
            return childNode;
        };
        childProcessingPromises.push(processItem());
    }

    const resolvedChildren = await Promise.all(childProcessingPromises);
    structure.children = resolvedChildren.filter(child => child !== null);

    structure.children.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        const nameA = a.name || '';
        const nameB = b.name || '';
        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });

    return structure;
}

async function findGitRepositories(startPath, maxDepth = 5, currentDepth = 0) {
    if (currentDepth > maxDepth) {
        return [];
    }

    let foundRepos = [];
    let dirents;

    try {
        dirents = await fsp.readdir(startPath, { withFileTypes: true });
    } catch (err) {
        console.warn(`Cannot read directory ${startPath}: ${err.message}`);
        return [];
    }

    let hasGit = false;
    const subDirPromises = [];

    for (const dirent of dirents) {
        const fullPath = path.join(startPath, dirent.name);

        if (dirent.name === '.git' && dirent.isDirectory()) {
            hasGit = true;
        } else if (dirent.isDirectory() && dirent.name !== 'node_modules' && !dirent.name.startsWith('.')) {
             subDirPromises.push(findGitRepositories(fullPath, maxDepth, currentDepth + 1));
        }
    }

     if (hasGit) {
        foundRepos.push(startPath);
     } else {
         const subDirResults = await Promise.all(subDirPromises);
         foundRepos = foundRepos.concat(...subDirResults);
     }

     if (currentDepth === 0) {
        return [...new Set(foundRepos)];
     }
     return foundRepos;
}

function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    // Handle potential log(0) or log(negative) issues if bytes is somehow invalid
    if (bytes <= 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    // Ensure index is within bounds
    const index = Math.min(i, sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, index)).toFixed(dm)) + ' ' + sizes[index];
}


async function readFileContent(filePath) {
    if (!filePath) throw new Error("File path is required.");
    let stats;
    try {
        stats = await fsp.stat(filePath);
        if (stats.isDirectory()) throw new Error("Path is a directory.");
        const maxSize = 5 * 1024 * 1024; // Increased view limit to 5MB
        if (stats.size > maxSize) {
            throw new Error(`File too large to view (${formatBytes(stats.size)}, max ${formatBytes(maxSize)}).`);
        }
        if (stats.size === 0) return "";
    } catch (error) {
        if (error.code === 'ENOENT') throw new Error(`File not found: ${filePath}`);
        throw error;
    }

    try {
        const content = await fsp.readFile(filePath, 'utf-8');
        if (content.includes('\u0000')) {
             // Allow viewing if it looks *mostly* like text despite some nulls? Maybe not.
            throw new Error("File appears to be binary or has unsupported encoding.");
        }
        return content;
    } catch (error) {
        if (error.code === 'EACCES') throw new Error(`Permission denied reading file: ${filePath}`);
        if (error instanceof TypeError && error.message.includes('ERR_INVALID_CHAR')) {
            throw new Error("Cannot display file: Likely binary or unsupported text encoding.");
        }
        console.warn(`Failed reading ${filePath} as utf-8: ${error.message}`);
        // Try reading with latin1 as a fallback for some binary-ish text files
        try {
             console.log(`Attempting to read ${filePath} as latin1...`);
             const latin1Content = await fsp.readFile(filePath, 'latin1');
             // Check for excessive null bytes again in latin1
              if ((latin1Content.match(/\u0000/g) || []).length > latin1Content.length * 0.1) { // If > 10% null bytes
                 throw new Error("File still appears to be binary even with latin1 encoding.");
             }
             console.log(`Read ${filePath} successfully as latin1 (fallback).`);
             return latin1Content; // Return potentially garbled but viewable content
        } catch (fallbackError) {
            console.warn(`Failed reading ${filePath} as latin1 fallback: ${fallbackError.message}`);
             throw new Error(`Could not read file content. It might be binary or have an unsupported encoding.`);
        }
    }
}

async function exportProject(basePath, savePath, format = 'md', options = {}) {
    const { allowedExtensions = [], ignoredItems = [] } = options;
    const ignoredItemsSet = new Set(ignoredItems.map(item => item.toLowerCase()));
    const allowedExtSet = new Set(allowedExtensions.map(ext => ext.toLowerCase()));
    const outputFilePath = savePath;
    let filesProcessed = 0;
    let filesSkipped = 0;
    let totalBytes = 0;
    const maxSizePerFile = 10 * 1024 * 1024; // 10MB limit per file for export

    const outputStream = fs.createWriteStream(outputFilePath, { encoding: 'utf8' });

    try {
        if (format === 'xml') {
            outputStream.write('<?xml version="1.0" encoding="UTF-8"?>\n<project root="' + escapeXml(basePath) + '">\n');
        } else if (format === 'structure') {
             outputStream.write(`Structure export for: ${basePath}\n`);
             outputStream.write('='.repeat(40) + '\n');
        }

        await walkAndExport(basePath, basePath, outputStream, format, allowedExtSet, ignoredItemsSet, maxSizePerFile, (type, count = 1) => {
            if (type === 'processed') filesProcessed += count;
            else if (type === 'skipped') filesSkipped += count;
            else if (type === 'bytes') totalBytes += count;
        });

         if (format === 'xml') {
             outputStream.write('</project>\n');
         } else if (format === 'structure') {
             // No footer needed
         }

    } finally {
         await new Promise((resolve) => {
             outputStream.end(resolve);
         });
    }

    console.log(`Export complete (${format}). Processed: ${filesProcessed}, Skipped: ${filesSkipped}, Total Size: ${formatBytes(totalBytes)}`);
    return `Processed: ${filesProcessed} files, Skipped: ${filesSkipped}, Total Size: ${formatBytes(totalBytes)}.`;
}

async function walkAndExport(basePath, currentPath, stream, format, allowedExtSet, ignoredItemsSet, maxSizePerFile, updateStats, depth = 0) {
    let dirents;
    try {
        dirents = await fsp.readdir(currentPath, { withFileTypes: true });
    } catch (err) {
        console.warn(`Skipping directory ${currentPath}: ${err.message}`);
        updateStats('skipped');
        const relativePath = path.relative(basePath, currentPath).replace(/\\/g, '/');
        if (format === 'md') stream.write(`\n--- Error reading directory: ${relativePath} (${err.message}) ---\n`);
        else if (format === 'xml') stream.write(`${'  '.repeat(depth + 1)}<error type="directory" path="${escapeXml(relativePath)}">${escapeXml(err.message)}</error>\n`);
        else if (format === 'structure') stream.write(`${'  '.repeat(depth + 1)}|-- [Error reading directory: ${relativePath} (${err.message})]\n`);
        return;
    }

    dirents.sort((a, b) => {
        const typeA = a.isDirectory() ? 0 : a.isFile() ? 1 : 2;
        const typeB = b.isDirectory() ? 0 : b.isFile() ? 1 : 2;
        if (typeA !== typeB) return typeA - typeB;
        return a.name.localeCompare(b.name);
    });

    for (const dirent of dirents) {
        const itemName = dirent.name;
        const itemPath = path.join(currentPath, itemName);
        const relativePath = path.relative(basePath, itemPath).replace(/\\/g, '/');
        const prefix = `${'  '.repeat(depth)}|-- `;

        if (ignoredItemsSet.has(itemName.toLowerCase())) {
            continue;
        }

        if (dirent.isDirectory()) {
             if (format === 'xml') stream.write(`${'  '.repeat(depth + 1)}<directory name="${escapeXml(itemName)}" path="${escapeXml(relativePath)}">\n`);
             else if (format === 'structure') stream.write(`${prefix}${itemName}/\n`);

            await walkAndExport(basePath, itemPath, stream, format, allowedExtSet, ignoredItemsSet, maxSizePerFile, updateStats, depth + 1);

             if (format === 'xml') stream.write(`${'  '.repeat(depth + 1)}</directory>\n`);

        } else if (dirent.isFile()) {
            const fileExt = path.extname(itemName).toLowerCase();
            const fileNameLower = itemName.toLowerCase();

            // Combine checks: is the extension in the set OR is the full lowercase name in the allowed list?
            const isAllowedExt = allowedExtSet.has(fileExt);
            // Need the original list for includes check as Set doesn't have it
            const isAllowedName = options.allowedExtensions.includes(fileNameLower);

            if (isAllowedExt || isAllowedName) {
                 try {
                     const stats = await fsp.stat(itemPath);
                     if (stats.size > maxSizePerFile) {
                         console.warn(`Skipping large file (${formatBytes(stats.size)}): ${itemPath}`);
                         updateStats('skipped');
                         if (format === 'md') stream.write(`\n--- Skipped large file: ${relativePath} (${formatBytes(stats.size)}) ---\n`);
                         else if (format === 'xml') stream.write(`${'  '.repeat(depth + 1)}<file name="${escapeXml(itemName)}" path="${escapeXml(relativePath)}" error="File too large (${formatBytes(stats.size)})"/>\n`);
                         else if (format === 'structure') stream.write(`${prefix}${itemName} [Skipped: Too Large]\n`);
                         continue;
                     }

                     if (format === 'structure') {
                         stream.write(`${prefix}${itemName}\n`);
                         updateStats('processed');
                         updateStats('bytes', stats.size);
                         continue;
                     }

                     let content;
                     let readError = null;
                     try {
                        content = await fsp.readFile(itemPath, 'utf-8');
                        if (content.includes('\u0000')) {
                            readError = new Error("Skipped: Binary content detected");
                        }
                     } catch(utf8Error) {
                         // Try latin1 as fallback
                         try {
                            content = await fsp.readFile(itemPath, 'latin1');
                             // Optional: Check for excessive null bytes in latin1 too
                            if ((content.match(/\u0000/g) || []).length > content.length * 0.1) {
                                readError = new Error("Skipped: Binary content detected (latin1)");
                            }
                         } catch (latin1Error) {
                             readError = utf8Error; // Use original UTF-8 error if latin1 also fails
                         }
                     }

                     if(readError) {
                        console.warn(`Skipping file ${itemPath}: ${readError.message}`);
                        updateStats('skipped');
                        if (format === 'md') stream.write(`\n--- ${readError.message}: ${relativePath} ---\n`);
                        else if (format === 'xml') stream.write(`${'  '.repeat(depth + 1)}<file name="${escapeXml(itemName)}" path="${escapeXml(relativePath)}" error="${escapeXml(readError.message)}"/>\n`);
                        // Structure case handled above
                        continue;
                     }


                     if (format === 'md') {
                         const separatorStart = `\n--- File: ${relativePath} ---\n`;
                         const separatorEnd = `\n--- End File: ${relativePath} ---\n`;
                         const codeBlockStart = '```' + (fileExt.substring(1) || '') + '\n';
                         const codeBlockEnd = '\n```';
                         stream.write(separatorStart + codeBlockStart + content + codeBlockEnd + separatorEnd);
                     } else if (format === 'xml') {
                         stream.write(`${'  '.repeat(depth + 1)}<file name="${escapeXml(itemName)}" path="${escapeXml(relativePath)}" size="${stats.size}">\n`);
                         stream.write(`${'  '.repeat(depth + 2)}<content><![CDATA[`);
                         stream.write(content.replace(/]]>/g, ']]]]><![CDATA[>'));
                         stream.write(`]]></content>\n`);
                         stream.write(`${'  '.repeat(depth + 1)}</file>\n`);
                     }

                     updateStats('processed');
                     updateStats('bytes', stats.size);

                 } catch (statErr) { // Catch stat errors separately
                     console.warn(`Skipping file ${itemPath} due to stat error: ${statErr.message}`);
                     updateStats('skipped');
                      if (format === 'md') stream.write(`\n--- Error accessing file: ${relativePath} (${statErr.message}) ---\n`);
                      else if (format === 'xml') stream.write(`${'  '.repeat(depth + 1)}<file name="${escapeXml(itemName)}" path="${escapeXml(relativePath)}" error="Stat Error: ${escapeXml(statErr.message)}"/>\n`);
                      else if (format === 'structure') stream.write(`${prefix}${itemName} [Error: ${statErr.message}]\n`);
                 }
            } else {
                updateStats('skipped');
            }
        }
    }
}

function escapeXml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';  // Используем эквивалент HTML для одинарных кавычек
            case '"': return '&quot;';   // Используем эквивалент HTML для двойных кавычек
            default: return c;
        }
    });
}

module.exports = {
    validateDirectory,
    getDirectoryStructureRecursive,
    readFileContent,
    exportProject,
    findGitRepositories,
};