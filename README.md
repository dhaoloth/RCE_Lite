# Repo Console Lite

Repo Console Lite is a desktop application for browsing repository structures, viewing and editing files, and exporting project contents in various formats. It aims to provide a simple interface for quickly understanding and documenting codebases.

## Features

*   **Repository Structure Viewer**: Interactive tree-style display of files and folders.
*   **File Content Viewing**: View text-based files within the application.
*   **Syntax Highlighting**: Supports highlighting for numerous programming languages using Highlight.js.
*   **Basic File Editing**: Edit text files directly within the app (enable by double-clicking a file). Save changes with `Ctrl+S`, discard with `Esc`.
*   **Multi-Format Project Export**: Export project contents (filtered by extension and ignoring specified items like `node_modules`, binaries, etc.) as:
    *   Markdown (`.md`)
    *   XML (`.xml`)
    *   Text File Structure (`.txt`)
*   **Repository History**: Quickly access the last 5 opened folders via a dropdown menu (`Ctrl+H`).
*   **Repository Scanning**: Scan a selected "home" directory to find `.git` repositories within it.
*   **User-Friendly**: Minimalist interface with keyboard shortcuts.

## Installation

### Build from Source (Recommended for Developers)

1.  Ensure you have Node.js (v18+) and npm installed.
2.  **(Optional but Recommended for Windows Build):** Install Windows build tools:
    ```bash
    npm install --global --production windows-build-tools
    # or install Visual Studio Build Tools manually
    ```
3.  Clone the repository:
    ```bash
    git clone https://github.com/dhaoloth/RCE_Lite.git
    ```
4.  Navigate to the project directory:
    ```bash
    cd RCE_Lite # Or your folder name
    ```
5.  Install dependencies:
    ```bash
    npm install
    ```
6.  Run the application locally:
    ```bash
    npm start
    ```

### Prebuilt Release

You can download ready-to-use Windows versions (if provided) from the [Releases](https://github.com/dhaoloth/RCE_Lite/releases) section.

## Usage

1.  **Open Folder**: Click "Open Folder..." or use `Ctrl+O`.
2.  **Browse Files**: Click a file in the tree to view its contents.
3.  **Edit File**: **Double-click** a file in the tree to enable editing mode.
    *   Save changes with `Ctrl+S` or the "Save" button.
    *   Discard changes and exit editing mode by pressing `Esc`.
4.  **Export Project**: Click "Export Project" (`Ctrl+E`), choose a save location and format (`.md`, `.xml`, `.txt`).
5.  **History**: Click the "History" button or use `Ctrl+H` to see and open recent folders. Use "Clear History" within the dropdown to reset it.
6.  **Scan Dirs**: Click "Scan Dirs", select a parent directory, and the file tree will be replaced with a list of found Git repositories. Click a result to open it.

## Build Instructions (Windows 10+)

After following the "Build from Source" steps (including installing dependencies):

*   **Build for both 32-bit and 64-bit Windows (NSIS Installer):**
    ```bash
    npm run build:win
    ```
*   **Build only for 64-bit Windows:**
    ```bash
    npm run build:win64
    ```
*   **Build only for 32-bit Windows:**
    ```bash
    npm run build:win32
    ```

The installers/executables will be located in the `dist` directory.

## Technologies

*   **Electron**: For cross-platform desktop application development.
*   **Highlight.js**: For syntax highlighting.
*   **Font Awesome**: For interface icons.
*   **electron-store**: For persistent history storage.

## License

This project is licensed under the MIT License.

---

### Screenshots
![alt text](image.png)

---

For questions or suggestions, please open an [Issue](https://github.com/dhaoloth/RCE_Lite/issues) or contact me.