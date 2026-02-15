


import { FileNode, FileType, VFSProject, SystemProtocol } from "../types";
import { systemBus } from "./systemBus";
// import * as fs from 'fs'; // REMOVED: Incompatible with Browser Build

const VFS_FILE = './silhouette_vfs_db.json';

// --- VIRTUAL FILE SYSTEM (VFS) ---
// Emulates a physical SSD within the browser's LocalStorage.
// Supports hierarchical file structures, persistence, and CRUD operations.

class VirtualFileSystem {
    private projects: VFSProject[] = [];
    private fileNodes: Map<string, FileNode> = new Map();
    private readonly STORAGE_KEY_PROJECTS = 'silhouette_vfs_projects';
    private readonly STORAGE_KEY_NODES = 'silhouette_vfs_nodes';

    constructor() {
        this.loadFromStorage();
        if (this.projects.length === 0) {
            this.seedDemoProject();
        }
    }

    // --- PROJECT MANAGEMENT ---

    public getProjects(): VFSProject[] {
        return this.projects;
    }

    public createProject(name: string, type: VFSProject['type']): VFSProject {
        const rootId = crypto.randomUUID();
        const project: VFSProject = {
            id: crypto.randomUUID(),
            name,
            type,
            rootFolderId: rootId,
            createdAt: Date.now(),
            lastOpened: Date.now()
        };

        // Create Root Folder Node
        const rootNode: FileNode = {
            id: rootId,
            name: 'root',
            type: 'FOLDER',
            parentId: null,
            children: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        this.projects.push(project);
        this.fileNodes.set(rootId, rootNode);

        // Scaffold basic files based on template
        this.scaffoldProject(rootId, type);

        this.saveToStorage();

        // Notify System of Filesystem Change
        systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId: project.id, action: 'CREATE' }, 'VFS');

        return project;
    }

    public deleteProject(projectId: string) {
        const project = this.projects.find(p => p.id === projectId);
        if (project) {
            // Recursive delete of all nodes
            this.deleteNodeRecursively(project.rootFolderId);
            this.projects = this.projects.filter(p => p.id !== projectId);
            this.saveToStorage();

            // Notify System
            systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId, action: 'DELETE' }, 'VFS');
        }
    }

    // --- AI INGESTION (NEW) ---
    public ingestProjectStructure(projectName: string, structure: any): string {
        // Create blank project
        const project = this.createProject(projectName, 'REACT');

        // Clear default scaffold (except root) to respect AI structure
        const root = this.fileNodes.get(project.rootFolderId);
        if (root && root.children) {
            [...root.children].forEach(childId => this.deleteNodeRecursively(childId));
            root.children = [];
        }

        // Recursive ingest function
        const processNode = (parentInfo: { id: string }, node: any) => {
            if (node.type === 'FOLDER') {
                const folder = this.createFolder(parentInfo.id, node.name);
                if (node.children && Array.isArray(node.children)) {
                    node.children.forEach((child: any) => processNode(folder, child));
                }
            } else if (node.type === 'FILE') {
                this.createFile(parentInfo.id, node.name, node.content || '');
            }
        };

        // Start ingestion from root
        if (structure.root && Array.isArray(structure.root)) {
            structure.root.forEach((node: any) => processNode(root!, node));
        }

        this.saveToStorage();
        return project.id;
    }

    // --- DEEP PROJECT INDEXING (MEMORY RAG) ---
    public getProjectIndex(projectId: string): string[] {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return [];

        const index: string[] = [];

        // Recursive Scanner
        const scan = (folderId: string, path: string) => {
            const children = this.getFileTree(folderId);
            for (const child of children) {
                if (child.type === 'FOLDER') {
                    scan(child.id, `${path}/${child.name}`);
                } else {
                    const fullPath = `${path}/${child.name}`;
                    // Extract symbols (Simple regex for export const/function/interface)
                    const content = child.content || '';
                    const exports = content.match(/export\s+(const|function|interface|class|type)\s+([a-zA-Z0-9_]+)/g);

                    if (exports) {
                        const symbols = exports.map(e => e.split(' ')[2]);
                        index.push(`FILE: ${fullPath} | EXPORTS: ${symbols.join(', ')}`);
                    } else {
                        index.push(`FILE: ${fullPath}`);
                    }
                }
            }
        };

        scan(project.rootFolderId, '');
        return index;
    }

    // --- OMNISCIENT CONTEXT ENGINE ---
    public getProjectContext(projectId: string): string {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return "NO_PROJECT_ACTIVE";

        let context = `# PROJECT: ${project.name} (${project.type})\n\n## FILE TREE\n`;

        // 1. Generate Tree
        const buildTree = (folderId: string, depth: number) => {
            const children = this.getFileTree(folderId);
            for (const child of children) {
                const indent = "  ".repeat(depth);
                context += `${indent}- ${child.name}${child.type === 'FOLDER' ? '/' : ''}\n`;
                if (child.type === 'FOLDER') {
                    buildTree(child.id, depth + 1);
                }
            }
        };
        buildTree(project.rootFolderId, 0);

        // 2. Generate Key File Summaries (Limit to avoid token overflow)
        context += `\n## KEY FILES CONTENT\n`;
        const importantFiles = ['package.json', 'App.tsx', 'main.tsx', 'index.ts', 'types.ts', 'vite.config.ts'];

        const scanContent = (folderId: string) => {
            const children = this.getFileTree(folderId);
            for (const child of children) {
                if (child.type === 'FILE') {
                    // Check if important OR small enough (< 2KB) and source code
                    const isImportant = importantFiles.includes(child.name);
                    const isSource = child.name.endsWith('.ts') || child.name.endsWith('.tsx') || child.name.endsWith('.js') || child.name.endsWith('.css');

                    if (isImportant || (isSource && (child.content?.length || 0) < 2000)) {
                        context += `\n### ${child.name}\n\`\`\`${child.name.split('.').pop()}\n${child.content}\n\`\`\`\n`;
                    }
                } else {
                    scanContent(child.id);
                }
            }
        };
        scanContent(project.rootFolderId);

        return context;
    }

    // --- FILE OPERATIONS ---

    public getFileTree(folderId: string): FileNode[] {
        const folder = this.fileNodes.get(folderId);
        if (!folder || !folder.children) return [];
        return folder.children
            .map(id => this.fileNodes.get(id)!)
            .filter(Boolean)
            .sort((a, b) => {
                // Folders first, then files
                if (a.type === b.type) return a.name.localeCompare(b.name);
                return a.type === 'FOLDER' ? -1 : 1;
            });
    }

    public createFile(parentId: string, name: string, content: string = ''): FileNode {
        const fileId = crypto.randomUUID();
        const newNode: FileNode = {
            id: fileId,
            name,
            type: 'FILE',
            content,
            parentId,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        this.fileNodes.set(fileId, newNode);
        this.attachToParent(parentId, fileId);
        this.saveToStorage();

        // Notify System
        systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId: this.getProjectIdForNode(parentId), fileId: newNode.id, action: 'CREATE' }, 'VFS');

        return newNode;
    }

    public createFolder(parentId: string, name: string): FileNode {
        const folderId = crypto.randomUUID();
        const newNode: FileNode = {
            id: folderId,
            name,
            type: 'FOLDER',
            parentId,
            children: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        this.fileNodes.set(folderId, newNode);
        this.attachToParent(parentId, folderId);
        this.saveToStorage();
        return newNode;
    }

    public updateFile(fileId: string, content: string) {
        const node = this.fileNodes.get(fileId);
        if (node && node.type === 'FILE') {
            node.content = content;
            node.updatedAt = Date.now();
            this.saveToStorage();

            // Notify System
            systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId: this.getProjectIdForNode(fileId), fileId: fileId, action: 'UPDATE' }, 'VFS');
        }
    }

    public deleteNode(nodeId: string) {
        this.deleteNodeRecursively(nodeId);
        const projectId = this.getProjectIdForNode(nodeId);
        this.deleteNodeRecursively(nodeId);
        this.saveToStorage();

        // Notify System
        systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId, fileId: nodeId, action: 'DELETE' }, 'VFS');
    }

    private getProjectIdForNode(nodeId: string): string | undefined {
        // Naive lookup: iterate projects and check if node is in tree. 
        // Since VFS is small, this is acceptable. Optimized: Store projectId on Node.
        // For now, let's just return the first active project or undefined, 
        // as CodebaseAwareness might just need the fileId if it looks up the node.
        // Actually, CodebaseAwareness uses vfs.getNode(fileId), so projectId is less critical for the update logic itself,
        // but good for filtering.
        // Let's implement a simple parent traversal if possible, or just return null if not easily found.
        // Given the flat map, we can walk up parentId until we hit a root folder, then find the project with that root.

        let curr = this.fileNodes.get(nodeId);
        while (curr && curr.parentId) {
            curr = this.fileNodes.get(curr.parentId);
        }
        if (curr) {
            return this.projects.find(p => p.rootFolderId === curr!.id)?.id;
        }
        return undefined;
    }

    public getNode(nodeId: string): FileNode | undefined {
        return this.fileNodes.get(nodeId);
    }

    // --- INTERNALS ---

    private attachToParent(parentId: string, childId: string) {
        const parent = this.fileNodes.get(parentId);
        if (parent && parent.children) {
            parent.children.push(childId);
        }
    }

    private deleteNodeRecursively(nodeId: string) {
        const node = this.fileNodes.get(nodeId);
        if (!node) return;

        // If parent exists, remove reference from parent
        if (node.parentId) {
            const parent = this.fileNodes.get(node.parentId);
            if (parent && parent.children) {
                parent.children = parent.children.filter(id => id !== nodeId);
            }
        }

        // If folder, delete children first
        if (node.type === 'FOLDER' && node.children) {
            [...node.children].forEach(childId => this.deleteNodeRecursively(childId));
        }

        this.fileNodes.delete(nodeId);
    }

    private scaffoldProject(rootId: string, type: VFSProject['type']) {
        if (type === 'REACT') {
            this.createFile(rootId, 'package.json', JSON.stringify({ name: 'react-app', version: '1.0.0', dependencies: { react: '^18.0.0' } }, null, 2));
            this.createFile(rootId, 'index.html', '<!DOCTYPE html>\n<html>\n<body>\n  <div id="root"></div>\n</body>\n</html>');
            this.createFile(rootId, 'vite.config.ts', 'import { defineConfig } from "vite";\nexport default defineConfig({});');

            const srcId = this.createFolder(rootId, 'src').id;
            this.createFile(srcId, 'App.tsx', `import React, { useState } from 'react';\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <div className="p-4 bg-slate-900 text-white h-screen">\n      <h1 className="text-2xl font-bold">Hello Silhouette VFS</h1>\n      <p>This file is persisted in your Virtual SSD.</p>\n      <button onClick={() => setCount(c => c+1)} className="mt-4 px-4 py-2 bg-cyan-600 rounded">\n        Count: {count}\n      </button>\n    </div>\n  );\n}`);
            this.createFile(srcId, 'main.tsx', `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\n\nReactDOM.createRoot(document.getElementById('root')!).render(<App />);`);
        } else if (type === 'NODE') {
            this.createFile(rootId, 'package.json', JSON.stringify({ name: 'node-api', main: 'index.js' }, null, 2));
            this.createFile(rootId, 'index.js', 'const express = require("express");\nconst app = express();\n\napp.get("/", (req, res) => res.send("Hello World"));\n\napp.listen(3000);');
        }
    }

    private seedDemoProject() {
        this.createProject('Demo Dashboard', 'REACT');
    }

    private saveToStorage() {
        try {
            if (typeof window !== 'undefined') {
                localStorage.setItem(this.STORAGE_KEY_PROJECTS, JSON.stringify(this.projects));
                localStorage.setItem(this.STORAGE_KEY_NODES, JSON.stringify(Array.from(this.fileNodes.entries())));
            }
        } catch (e) {
            console.error("VFS Save Failed", e);
        }
    }

    private loadFromStorage() {
        if (typeof window !== 'undefined') {
            const p = localStorage.getItem(this.STORAGE_KEY_PROJECTS);
            const n = localStorage.getItem(this.STORAGE_KEY_NODES);

            if (p) this.projects = JSON.parse(p);
            if (n) {
                const entries = JSON.parse(n);
                this.fileNodes = new Map(entries);
            }
        }
    }
}

export const vfs = new VirtualFileSystem();
