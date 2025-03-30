# Repo Console Lite

Repo Console Lite is a lightweight desktop application for browsing repository structures and exporting their contents in a convenient format. The app allows you to open folders, view files with syntax highlighting, and export projects as Markdown files.

## Features

- **Repository Structure Viewer**: Tree-style display of files and folders.
- **Syntax Highlighting**: Supports highlighting for various programming languages using Highlight.js.
- **Project Export**: Save project contents to a Markdown file with extension filtering and ignored files (e.g., `node_modules`).
- **User-Friendly**: Minimalist interface with keyboard shortcuts support.

## Installation

### Build from Source

1. Ensure you have Node.js and npm installed.
2. Clone the repository:
   ```bash
   git clone https://github.com/dhaoloth/RCE_Lite.git
   ```
3. Navigate to the project directory:
   ```bash
   cd repo-console-lite
   ```
4. Install dependencies:
   ```bash
   npm install
   ```
5. Run the application:
   ```bash
   npm start
   ```

### Prebuilt Release

You can download the ready-to-use Windows version from the [Releases](https://github.com/dhaoloth/RCE_Lite/releases) section.

## Usage

1. **Open Folder**: Click the "Open Folder" button or use the `Ctrl+O` shortcut.
2. **Browse Files**: Select a file in the tree to view its contents.
3. **Export Project**: Click the "Export Project" button (`Ctrl+E`) to save the project contents as a Markdown file.

## Technologies

- **Electron**: For cross-platform desktop application.
- **Highlight.js**: For syntax highlighting.
- **Font Awesome**: For interface icons.

## License

This project is licensed under the MIT License.

---

### Screenshots
![alt text](image.png)

---

For questions or suggestions, please open an [Issue](https://github.com/dhaoloth/RCE_Lite/issues) or contact me.