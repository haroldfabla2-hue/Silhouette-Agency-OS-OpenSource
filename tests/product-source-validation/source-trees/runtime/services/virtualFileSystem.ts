import { FileNode, VFSProject, SystemProtocol } from "../types";
import { systemBus } from "./systemBus";
import { api } from "../utils/api";

// --- SERVER-BACKED FILE SYSTEM (audit batch 2) ---
// Real view of the server workspace: the same directory the Genesis factory
// builds into. No localStorage, no demo seeds. Reads come from an in-memory
// cache hydrated from GET /v1/workspace/tree; file contents load on demand;
// every mutation writes through to the server. Deletes go to quarantine on
// the server side (eternal-memory invariant: nothing is truly deleted).

interface TreeEntry {
    id: string;          // path relative to the workspace root, '/'-separated
    parentId: string;    // '' for top-level entries
    name: string;
    type: 'file' | 'folder';
    size?: number;
    mtime?: number;
}

class VirtualFileSystem {
    private projects: VFSProject[] = [];
    private fileNodes: Map<string, FileNode> = new Map();
    private ready = false;
    private initPromise: Promise<void> | null = null;
    private writeTimers: Map<string, any> = new Map();

    public isReady(): boolean { return this.ready; }

    public async init(): Promise<void> {
        if (this.ready) return;
        if (!this.initPromise) {
            this.initPromise = (async () => {
                const res = await api.get('/v1/workspace/tree') as any;
                this.hydrate((res.nodes || []) as TreeEntry[]);
                this.ready = true;
            })().catch(err => {
                this.initPromise = null;
                throw err;
            });
        }
        return this.initPromise;
    }

    public async refresh(): Promise<void> {
        this.ready = false;
        this.initPromise = null;
        return this.init();
    }

    private hydrate(entries: TreeEntry[]) {
        this.projects = [];
        this.fileNodes.clear();
        const childMap = new Map<string, string[]>();
        for (const e of entries) {
            const node: FileNode = {
                id: e.id,
                name: e.name,
                type: e.type === 'folder' ? 'FOLDER' : 'FILE',
                parentId: e.parentId || null,
                children: e.type === 'folder' ? [] : undefined,
                createdAt: e.mtime || Date.now(),
                updatedAt: e.mtime || Date.now()
            };
            this.fileNodes.set(e.id, node);
            if (e.parentId) {
                const list = childMap.get(e.parentId) || [];
                list.push(e.id);
                childMap.set(e.parentId, list);
            } else if (node.type === 'FOLDER') {
                // A real top-level folder in the workspace is a project.
                this.projects.push({
                    id: node.id,
                    name: node.name,
                    type: 'REACT',
                    rootFolderId: node.id,
                    createdAt: node.createdAt,
                    lastOpened: Date.now()
                });
            }
        }
        for (const [pid, kids] of childMap) {
            const parent = this.fileNodes.get(pid);
            if (parent && parent.children) parent.children = kids;
        }
    }

    // --- PROJECT MANAGEMENT ---

    public getProjects(): VFSProject[] {
        return this.projects;
    }

    public createProject(name: string, type: VFSProject['type']): VFSProject {
        const clean = name.trim().replace(/\s+/g, '-');
        const project: VFSProject = {
            id: clean,
            name: clean,
            type,
            rootFolderId: clean,
            createdAt: Date.now(),
            lastOpened: Date.now()
        };
        const rootNode: FileNode = {
            id: clean,
            name: clean,
            type: 'FOLDER',
            parentId: null,
            children: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        if (!this.fileNodes.has(clean)) {
            this.projects.push(project);
            this.fileNodes.set(clean, rootNode);
        }
        api.post('/v1/workspace/project', { name: clean })
            .catch(e => console.error('[VFS] project create failed on server', e));
        systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId: project.id, action: 'CREATE' }, 'VFS');
        return project;
    }

    public deleteProject(projectId: string) {
        const project = this.projects.find(p => p.id === projectId);
        if (project) {
            this.removeSubtree(project.rootFolderId);
            this.projects = this.projects.filter(p => p.id !== projectId);
            api.post('/v1/workspace/quarantine', { path: project.rootFolderId })
                .catch(e => console.error('[VFS] project quarantine failed on server', e));
            systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId, action: 'DELETE' }, 'VFS');
        }
    }

    // --- AI INGESTION ---
    public ingestProjectStructure(projectName: string, structure: any): string {
        const project = this.createProject(projectName, 'REACT');
        const processNode = (parentId: string, node: any) => {
            if (node.type === 'FOLDER') {
                const folder = this.createFolder(parentId, node.name);
                if (node.children && Array.isArray(node.children)) {
                    node.children.forEach((child: any) => processNode(folder.id, child));
                }
            } else if (node.type === 'FILE') {
                this.createFile(parentId, node.name, node.content || '');
            }
        };
        if (structure.root && Array.isArray(structure.root)) {
            structure.root.forEach((node: any) => processNode(project.rootFolderId, node));
        }
        return project.id;
    }

    // --- DEEP PROJECT INDEXING (MEMORY RAG) ---
    public getProjectIndex(projectId: string): string[] {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return [];

        const index: string[] = [];
        const scan = (folderId: string, path: string) => {
            const children = this.getFileTree(folderId);
            for (const child of children) {
                if (child.type === 'FOLDER') {
                    scan(child.id, `${path}/${child.name}`);
                } else {
                    const fullPath = `${path}/${child.name}`;
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
        const buildTree = (folderId: string, depth: number) => {
            const children = this.getFileTree(folderId);
            for (const child of children) {
                const indent = "  ".repeat(depth);
                context += `${indent}- ${child.name}${child.type === 'FOLDER' ? '/' : ''}\n`;
                if (child.type === 'FOLDER') buildTree(child.id, depth + 1);
            }
        };
        buildTree(project.rootFolderId, 0);

        context += `\n## KEY FILES CONTENT\n`;
        const importantFiles = ['package.json', 'App.tsx', 'main.tsx', 'index.ts', 'types.ts', 'vite.config.ts'];
        const scanContent = (folderId: string) => {
            const children = this.getFileTree(folderId);
            for (const child of children) {
                if (child.type === 'FILE') {
                    const isImportant = importantFiles.includes(child.name);
                    const isSource = child.name.endsWith('.ts') || child.name.endsWith('.tsx') || child.name.endsWith('.js') || child.name.endsWith('.css');
                    if (isImportant || (isSource && (child.content?.length || 0) < 2000)) {
                        context += `\n### ${child.name}\n\`\`\`${child.name.split('.').pop()}\n${child.content || ''}\n\`\`\`\n`;
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
                if (a.type === b.type) return a.name.localeCompare(b.name);
                return a.type === 'FOLDER' ? -1 : 1;
            });
    }

    public createFile(parentId: string, name: string, content: string = ''): FileNode {
        const id = parentId ? `${parentId}/${name}` : name;
        const existing = this.fileNodes.get(id);
        if (existing && existing.type === 'FILE') {
            existing.content = content;
            existing.updatedAt = Date.now();
            this.scheduleWrite(id);
            return existing;
        }
        const newNode: FileNode = {
            id,
            name,
            type: 'FILE',
            content,
            parentId,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        this.fileNodes.set(id, newNode);
        this.attachToParent(parentId, id);
        api.post('/v1/workspace/file', { path: id, content })
            .catch(e => console.error('[VFS] file create failed on server', e));
        systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId: this.getProjectIdForNode(id), fileId: id, action: 'CREATE' }, 'VFS');
        return newNode;
    }

    public createFolder(parentId: string, name: string): FileNode {
        const id = parentId ? `${parentId}/${name}` : name;
        const existing = this.fileNodes.get(id);
        if (existing) return existing;
        const newNode: FileNode = {
            id,
            name,
            type: 'FOLDER',
            parentId,
            children: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        this.fileNodes.set(id, newNode);
        this.attachToParent(parentId, id);
        api.post('/v1/workspace/folder', { path: id })
            .catch(e => console.error('[VFS] folder create failed on server', e));
        return newNode;
    }

    public updateFile(fileId: string, content: string) {
        const node = this.fileNodes.get(fileId);
        if (node && node.type === 'FILE') {
            node.content = content;
            node.updatedAt = Date.now();
            this.scheduleWrite(fileId);
            systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId: this.getProjectIdForNode(fileId), fileId: fileId, action: 'UPDATE' }, 'VFS');
        }
    }

    public deleteNode(nodeId: string) {
        const projectId = this.getProjectIdForNode(nodeId);
        this.removeSubtree(nodeId);
        api.post('/v1/workspace/quarantine', { path: nodeId })
            .catch(e => console.error('[VFS] quarantine failed on server', e));
        systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId, fileId: nodeId, action: 'DELETE' }, 'VFS');
    }

    public getNode(nodeId: string): FileNode | undefined {
        return this.fileNodes.get(nodeId);
    }

    // Load a file's real content from the server on first access.
    public async loadContent(fileId: string): Promise<FileNode | undefined> {
        const node = this.fileNodes.get(fileId);
        if (!node || node.type !== 'FILE') return node;
        if (node.content !== undefined) return node;
        const res = await api.get(`/v1/workspace/file?path=${encodeURIComponent(fileId)}`) as any;
        node.content = res.content;
        node.updatedAt = res.mtime || node.updatedAt;
        return node;
    }

    // --- INTERNALS ---

    // Debounced write-through: the editor calls updateFile per keystroke.
    private scheduleWrite(fileId: string) {
        const prev = this.writeTimers.get(fileId);
        if (prev) clearTimeout(prev);
        this.writeTimers.set(fileId, setTimeout(() => {
            this.writeTimers.delete(fileId);
            const node = this.fileNodes.get(fileId);
            if (!node || node.type !== 'FILE') return;
            api.post('/v1/workspace/file', { path: fileId, content: node.content || '' })
                .catch(e => console.error('[VFS] write failed on server', e));
        }, 800));
    }

    private attachToParent(parentId: string | null, childId: string) {
        if (!parentId) return;
        const parent = this.fileNodes.get(parentId);
        if (parent && parent.children && !parent.children.includes(childId)) {
            parent.children.push(childId);
        }
    }

    private removeSubtree(nodeId: string) {
        const node = this.fileNodes.get(nodeId);
        if (!node) return;
        if (node.parentId) {
            const parent = this.fileNodes.get(node.parentId);
            if (parent && parent.children) {
                parent.children = parent.children.filter(id => id !== nodeId);
            }
        }
        if (node.type === 'FOLDER' && node.children) {
            [...node.children].forEach(childId => this.removeSubtree(childId));
        }
        this.fileNodes.delete(nodeId);
    }

    private getProjectIdForNode(nodeId: string): string | undefined {
        let curr = this.fileNodes.get(nodeId);
        while (curr && curr.parentId) {
            curr = this.fileNodes.get(curr.parentId);
        }
        if (curr) {
            return this.projects.find(p => p.rootFolderId === curr!.id)?.id;
        }
        return undefined;
    }
}

export const vfs = new VirtualFileSystem();
