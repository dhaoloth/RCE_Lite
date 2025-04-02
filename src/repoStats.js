const path = require('path');
const fs = require('fs').promises;

const languageExtensions = {
    'js': 'JavaScript',
    'jsx': 'JavaScript (React)',
    'ts': 'TypeScript',
    'tsx': 'TypeScript (React)',
    'py': 'Python',
    'java': 'Java',
    'cpp': 'C++',
    'c': 'C',
    'cs': 'C#',
    'go': 'Go',
    'rb': 'Ruby',
    'php': 'PHP',
    'html': 'HTML',
    'css': 'CSS',
    'scss': 'SCSS',
    'json': 'JSON',
    'md': 'Markdown',
    'sql': 'SQL',
    'sh': 'Shell',
    'bat': 'Batch',
    'ps1': 'PowerShell',
    'vue': 'Vue',
    'svelte': 'Svelte',
    'rs': 'Rust',
    'swift': 'Swift',
    'kt': 'Kotlin',
    'dart': 'Dart',
    'ex': 'Elixir',
    'elm': 'Elm',
    'lua': 'Lua',
    'r': 'R',
    'scala': 'Scala',
    'pl': 'Perl',
    'h': 'C/C++ Header',
    'yml': 'YAML',
    'yaml': 'YAML',
    'toml': 'TOML',
    'xml': 'XML',
    'gradle': 'Gradle',
    'dockerfile': 'Dockerfile'
};

class RepoStats {
    constructor() {
        this.reset();
    }

    reset() {
        this.totalFiles = 0;
        this.totalDirs = 0;
        this.totalSize = 0;
        this.languages = new Map();
    }

    async analyzeRepository(repoPath, isGitHub = false) {
        console.log('[analyzeRepository] Starting analysis...');
        this.reset();

        if (isGitHub) {
            console.warn('[analyzeRepository] GitHub analysis called, but feature is currently disabled/placeholder.');
            return {
                files: 0,
                directories: 0,
                size: 'N/A (GitHub)',
                languages: []
            };
        } else {
            console.log('[analyzeRepository] Analyzing local directory...');
            await this.analyzeLocalDirectory(repoPath);
        }

        const result = {
            files: this.totalFiles,
            directories: this.totalDirs,
            size: this.formatSize(this.totalSize),
            languages: this.getLanguageStats()
        };

        console.log('[analyzeRepository] Analysis complete:', result);
        return result;
    }

    async analyzeLocalDirectory(dirPath) {
        try {
            console.log('[analyzeLocalDirectory] Analyzing:', dirPath);
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        this.totalDirs++;
                        console.log('[analyzeLocalDirectory] Found directory:', entry.name);
                        await this.analyzeLocalDirectory(fullPath);
                    }
                } else if (entry.isFile()) {
                    this.totalFiles++;
                    const stats = await fs.stat(fullPath);
                    this.totalSize += stats.size;
                    this.detectLanguage(entry.name);
                    console.log('[analyzeLocalDirectory] Found file:', entry.name, 'Size:', stats.size);
                }
            }
        } catch (error) {
            console.error('[analyzeLocalDirectory] Error analyzing directory:', error);
        }
    }

    analyzeGitHubStructure(structure) {
       // Эта функция больше не должна вызываться из analyzeRepository
       console.warn('[analyzeGitHubStructure] This function should not be called directly anymore.');
        return { files: 0, directories: 0, size: 'N/A (GitHub)', languages: [] };
    }

    detectLanguage(filename) {
        const ext = path.extname(filename).toLowerCase().slice(1);
        if (ext && languageExtensions[ext]) {
            const lang = languageExtensions[ext];
            this.languages.set(lang, (this.languages.get(lang) || 0) + 1);
        }
    }

    getLanguageStats() {
        if (this.totalFiles === 0) return []; // Избегаем деления на ноль
        const stats = Array.from(this.languages.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([lang, count]) => ({
                name: lang,
                count: count,
                percentage: Math.round((count / this.totalFiles) * 100)
            }));

        return stats;
    }

    formatSize(bytes) {
        if (bytes == null || bytes < 0) return '0 B'; // Добавлена проверка на null/undefined
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        // Используем toFixed(1), если есть дробная часть, иначе без дроби для B и KB
        const precision = (unitIndex <= 1 && size === Math.floor(size)) ? 0 : 1;
        return `${size.toFixed(precision)} ${units[unitIndex]}`;
    }
}

module.exports = new RepoStats();