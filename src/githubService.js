const axios = require('axios');
const cheerio = require('cheerio');
const URL = require('url-parse');

class GitHubService {
    constructor() {
        this.baseUrl = 'https://github.com';
        this.rawBaseUrl = 'https://raw.githubusercontent.com';
    }

    async getRepositoryStructure(repoUrl) {
        try {
            const parsedUrl = new URL(repoUrl);
            const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
            
            if (pathParts.length < 2) {
                throw new Error('Invalid GitHub repository URL');
            }

            const owner = pathParts[0];
            const repo = pathParts[1];
            const branch = pathParts[2] || 'main';
            const path = pathParts.slice(3).join('/');

            const response = await axios.get(`${this.baseUrl}/${owner}/${repo}/tree/${branch}/${path}`, {
                headers: {
                    'Accept': 'text/html',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            
            const structure = {
                type: 'directory',
                path: path || '/',
                children: []
            };

            // Parse repository contents
            $('.Box-row').each((_, element) => {
                const $element = $(element);
                const $link = $element.find('.js-navigation-open');
                const name = $link.text().trim();
                const href = $link.attr('href');
                const isDirectory = $element.find('[aria-label="Directory"]').length > 0;
                const sizeText = $element.find('.text-mono').last().text().trim();
                
                if (name && href) {
                    const childPath = href.split(`/${owner}/${repo}/`)[1]?.split('/').slice(1).join('/') || '';
                    structure.children.push({
                        type: isDirectory ? 'directory' : 'file',
                        path: childPath,
                        name: name,
                        size: this.parseSize(sizeText),
                        fullPath: `${this.baseUrl}${href}`
                    });
                }
            });

            return structure;
        } catch (error) {
            console.error('Error fetching repository structure:', error);
            throw new Error(`Failed to fetch repository structure: ${error.message}`);
        }
    }

    parseSize(sizeText) {
        if (!sizeText) return 'N/A';
        
        const match = sizeText.match(/(\d+\.?\d*)\s*(B|KB|MB|GB)/i);
        if (!match) return sizeText;

        const [, size, unit] = match;
        return `${size} ${unit}`;
    }

    async getFileContent(repoUrl) {
        try {
            const parsedUrl = new URL(repoUrl);
            const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
            
            if (pathParts.length < 3) {
                throw new Error('Invalid GitHub file URL');
            }

            const owner = pathParts[0];
            const repo = pathParts[1];
            const branch = pathParts[2] || 'main';
            const filePath = pathParts.slice(3).join('/');

            const response = await axios.get(`${this.rawBaseUrl}/${owner}/${repo}/${branch}/${filePath}`, {
                headers: {
                    'Accept': 'text/plain',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            return response.data;
        } catch (error) {
            console.error('Error fetching file content:', error);
            throw new Error(`Failed to fetch file content: ${error.message}`);
        }
    }

    isGitHubUrl(url) {
        try {
            const parsedUrl = new URL(url);
            return parsedUrl.hostname === 'github.com';
        } catch {
            return false;
        }
    }
}

module.exports = new GitHubService(); 