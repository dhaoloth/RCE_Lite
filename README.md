```markdown
# RCE Lite  

**Simple Repository Structure Viewer and Exporter**  

##  Overview  
RCE Lite is a lightweight tool designed to scan, visualize, and export the directory structure of a project or repository. It provides an organized and structured view, making it easier for developers to analyze, document, and share their project's architecture.  

##  Features  
- **Scans directory structure** – Generates a hierarchical view of files and folders.  
- **Exports results** – Supports exporting data in Markdown (`.md`) and JSON (`.json`) formats.  
- **Command-line interface (CLI)** – Simple usage from the terminal.  
- **Lightweight and fast** – No unnecessary dependencies, ensuring quick execution.  

##  Installation  
### **Prerequisites**  
- **Node.js** (Required for execution)  
- **Git** (For version control)  

### **Clone the Repository**  
```sh
git clone https://github.com/dhaoloth/RCE_Lite.git
cd RCE_Lite
```

##  Usage  
Run the script to generate a structured overview of your project's directory:  

### **Basic Command**  
```sh
node index.js
```
This will output the directory structure in a readable format.

### **Export to Markdown**  
```sh
node index.js --output structure.md
```
This command generates `structure.md` with the repository's structure formatted in Markdown.

### **Export to JSON**  
```sh
node index.js --json structure.json
```
Saves the directory structure as a JSON file for further processing.

## ⚙️ Configuration  
The tool supports optional configurations via command-line arguments:  
- `--output <filename>` → Exports the structure as a Markdown file.  
- `--json <filename>` → Exports the structure as a JSON file.  
- `--depth <number>` → Limits the depth of the scanned directory.  

Example:  
```sh
node index.js --output docs.md --depth 3
```
This command will export the directory structure up to **3 levels deep** into `docs.md`.

## 🛠 Example Output  

### **Terminal Output Example**  
```
📂 RCE_Lite  
 ├── 📄 index.js  
 ├── 📂 src  
 │   ├── 📄 parser.js  
 │   ├── 📄 exporter.js  
 ├── 📄 package.json  
 ├── 📄 README.md  
```

### **Markdown Export Example (`structure.md`)**  
```markdown
# Project Structure

- **RCE_Lite/**  
  - **index.js**  
  - **src/**  
    - **parser.js**  
    - **exporter.js**  
  - **package.json**  
  - **README.md**  
```

### **JSON Export Example (`structure.json`)**  
```json
{
  "name": "RCE_Lite",
  "children": [
    { "name": "index.js" },
    {
      "name": "src",
      "children": [
        { "name": "parser.js" },
        { "name": "exporter.js" }
      ]
    },
    { "name": "package.json" },
    { "name": "README.md" }
  ]
}
```

## 📜 License  
RCE Lite is released under the **MIT License**.  