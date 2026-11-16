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

type VFSIntentState = 'DEBOUNCED'|'QUEUED'|'RUNNING'|'HTTP_ACK'|'UNKNOWN'|'BLOCKED'|'SUPERSEDED';
interface VFSIntent {
    readonly sequence:number;
    readonly endpoint:string;
    readonly target:string;
    payload:Readonly<{path?:string;name?:string;content?:string}>;
    state:VFSIntentState;
    diagnostic?:string;
}

class VirtualFileSystem {
    private projects: VFSProject[] = [];
    private fileNodes: Map<string, FileNode> = new Map();
    private ready = false;
    private initPromise: Promise<void> | null = null;
    private writeTimers = new Map<string,{timer:ReturnType<typeof setTimeout>;intent:VFSIntent}>();
    private lifecycle:'OPEN'|'CLOSING'|'CLOSED'='OPEN';
    private revision=0;
    private readonly reads=new Set<Promise<unknown>>();
    private readonly intents:VFSIntent[]=[];
    private serial:Promise<void>=Promise.resolve();
    private uncertainty=false;
    private closing?:Promise<ReturnType<VirtualFileSystem['getLifecycleStatus']>>;

    private assertOpen(){if(this.lifecycle!=='OPEN')throw new Error('VFS closing; new work refused');}
    // Receipts intentionally exclude source content. Recovery payloads are only
    // returned by the explicit local accessor below, never logged or emitted.
    public getLifecycleStatus(){return {state:this.lifecycle,activeReads:this.reads.size,
        debounceTimers:this.writeTimers.size,uncertainty:this.uncertainty,
        durability:'UNVERIFIED' as const,pendingDurable:false,
        receipts:this.intents.map(({sequence,endpoint,target,state,diagnostic})=>({sequence,endpoint,target,state,diagnostic}))};}
    public getPendingIntents(){return this.intents.filter(i=>i.state!=='HTTP_ACK'&&i.state!=='SUPERSEDED')
        .map(i=>({...i,payload:{...i.payload}}));}
    private ownRead<T>(operation:()=>Promise<T>):Promise<T>{
        this.assertOpen();
        const actual=Promise.resolve().then(operation);this.reads.add(actual);
        void actual.then(()=>this.reads.delete(actual),()=>this.reads.delete(actual));return actual;
    }
    public shutdownLifecycle(){
        if(this.closing)return this.closing;
        this.lifecycle='CLOSING';
        // Accepted dirty bytes become writes, not canceled-and-forgotten timers.
        this.flushScheduled();
        this.closing=(async()=>{
            await Promise.allSettled([...this.reads]);
            await this.serial;
            this.lifecycle='CLOSED';
            return this.getLifecycleStatus();
        })();
        return this.closing;
    }
    private newIntent(endpoint:string,payload:VFSIntent['payload'],state:VFSIntentState):VFSIntent{
        const intent:VFSIntent={sequence:this.intents.length+1,endpoint,target:payload.path??payload.name??'',payload:Object.freeze({...payload}),state};
        this.intents.push(intent);return intent;
    }
    private enqueue(intent:VFSIntent){
        intent.state='QUEUED';
        this.serial=this.serial.then(async()=>{
            if(this.uncertainty){intent.state='BLOCKED';intent.diagnostic='Prior mutation outcome unknown; no automatic replay or dependent effect';return;}
            intent.state='RUNNING';
            try{
                const ack=await api.post<any>(intent.endpoint,intent.payload);
                const expected=intent.payload.path??intent.payload.name;
                const valid=ack?.success===true&&(intent.endpoint.endsWith('/quarantine')?
                    typeof ack.quarantinedTo==='string'&&ack.quarantinedTo.startsWith('.quarantine/')&&ack.quarantinedTo.endsWith('/'+expected):ack.path===expected);
                if(!valid)throw new Error('Workspace acknowledgement did not match mutation');
                // Route JSON ACK does not prove fsync, durable storage or replica receipt.
                intent.state='HTTP_ACK';intent.payload=Object.freeze({});
            }catch{
                intent.state='UNKNOWN';intent.diagnostic='Mutation outcome uncertain; inspect server before any retry';
                this.uncertainty=true;
            }
        });
    }
    private mutate(endpoint:string,payload:VFSIntent['payload']){
        this.flushScheduled();this.enqueue(this.newIntent(endpoint,payload,'QUEUED'));
    }
    private flushScheduled(){
        const scheduled=[...this.writeTimers.values()].sort((a,b)=>a.intent.sequence-b.intent.sequence);
        this.writeTimers.clear();
        for(const item of scheduled){clearTimeout(item.timer);this.enqueue(item.intent);}
    }


    public isReady(): boolean { return this.ready; }

    public async init():Promise<void>{
        this.assertOpen();
        if(this.ready)return;
        if(!this.initPromise){
            this.flushScheduled();
            const barrier=this.serial;
            const revision=this.revision;
            const actual=this.ownRead(async()=>{
                await barrier;
                if(this.uncertainty)throw new Error('VFS hydration refused: uncertain mutation retained');
                const res=await api.get<any>('/v1/workspace/tree');
                if(this.revision!==revision||this.lifecycle!=='OPEN')throw new Error('VFS hydration superseded; local state retained');
                this.hydrate((res.nodes||[]) as TreeEntry[]);this.ready=true;
            });
            this.initPromise=actual;
            void actual.catch(()=>{if(this.initPromise===actual)this.initPromise=null;});
        }
        return this.initPromise;
    }

    public async refresh():Promise<void>{
        this.assertOpen();this.flushScheduled();
        const revision=this.revision;
        await this.serial;
        this.assertOpen();
        if(this.uncertainty||this.revision!==revision)throw new Error('VFS refresh refused: unresolved or changed local mutations');
        if(this.initPromise&&!this.ready)await this.initPromise;
        this.assertOpen();
        if(this.revision!==revision)throw new Error('VFS refresh superseded; local state retained');
        this.ready=false;this.initPromise=null;
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
        this.assertOpen();this.revision++;
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
        this.mutate('/v1/workspace/project', { name: clean });
        systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId: project.id, action: 'CREATE' }, 'VFS');
        return project;
    }

    public deleteProject(projectId: string) {
        this.assertOpen();this.revision++;
        const project = this.projects.find(p => p.id === projectId);
        if (project) {
            this.removeSubtree(project.rootFolderId);
            this.projects = this.projects.filter(p => p.id !== projectId);
            this.mutate('/v1/workspace/quarantine', { path: project.rootFolderId });
            systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId, action: 'DELETE' }, 'VFS');
        }
    }

    // --- AI INGESTION ---
    public ingestProjectStructure(projectName: string, structure: any): string {
        this.assertOpen();this.revision++;
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
        this.assertOpen();this.revision++;
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
        this.mutate('/v1/workspace/file', { path: id, content });
        systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId: this.getProjectIdForNode(id), fileId: id, action: 'CREATE' }, 'VFS');
        return newNode;
    }

    public createFolder(parentId: string, name: string): FileNode {
        this.assertOpen();this.revision++;
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
        this.mutate('/v1/workspace/folder', { path: id });
        return newNode;
    }

    public updateFile(fileId: string, content: string) {
        this.assertOpen();this.revision++;
        const node = this.fileNodes.get(fileId);
        if (node && node.type === 'FILE') {
            node.content = content;
            node.updatedAt = Date.now();
            this.scheduleWrite(fileId);
            systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId: this.getProjectIdForNode(fileId), fileId: fileId, action: 'UPDATE' }, 'VFS');
        }
    }

    public deleteNode(nodeId: string) {
        this.assertOpen();this.revision++;
        const projectId = this.getProjectIdForNode(nodeId);
        this.removeSubtree(nodeId);
        this.mutate('/v1/workspace/quarantine', { path: nodeId });
        systemBus.emit(SystemProtocol.FILESYSTEM_UPDATE, { projectId, fileId: nodeId, action: 'DELETE' }, 'VFS');
    }

    public getNode(nodeId: string): FileNode | undefined {
        return this.fileNodes.get(nodeId);
    }

    // Load a file's real content from the server on first access.
    public async loadContent(fileId:string):Promise<FileNode|undefined>{
        this.assertOpen();
        const node=this.fileNodes.get(fileId);
        if(!node||node.type!=='FILE'||node.content!==undefined)return node;
        const revision=this.revision;
        return this.ownRead(async()=>{
            const res=await api.get<any>(`/v1/workspace/file?path=${encodeURIComponent(fileId)}`);
            if(this.lifecycle==='OPEN'&&this.revision===revision&&this.fileNodes.get(fileId)===node&&node.content===undefined){
                node.content=res.content;node.updatedAt=res.mtime||node.updatedAt;
            }
            return this.fileNodes.get(fileId);
        });
    }

    // Timers own immutable bytes, never re-read a deleted/replaced node later.
    private scheduleWrite(fileId:string){
        const node=this.fileNodes.get(fileId);if(!node||node.type!=='FILE')return;
        const previous=this.writeTimers.get(fileId);
        if(previous){clearTimeout(previous.timer);previous.intent.state='SUPERSEDED';previous.intent.payload=Object.freeze({});}
        const intent=this.newIntent('/v1/workspace/file',{path:fileId,content:node.content??''},'DEBOUNCED');
        const timer=setTimeout(()=>{
            const current=this.writeTimers.get(fileId);
            if(current?.intent!==intent)return;
            this.writeTimers.delete(fileId);this.enqueue(intent);
        },800);
        this.writeTimers.set(fileId,{timer,intent});
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
