import fs from 'fs';
import path from 'path';

export interface AuditResult {
    fileCount: number;
    documentationSync: boolean;
    structuralAlignment: boolean;
    issues: string[];
}

export class ArchitectAuditTool {
    private rootDir: string;

    constructor(rootDir: string = process.cwd()) {
        this.rootDir = rootDir;
    }

    public async performAudit(): Promise<AuditResult> {
        const issues: string[] = [];
        const requiredFiles = [
            'silhouette.config.json',
            'ARQUITECTURA_EVOLUTIVA.md',
            'DIRECTIVA_OPERACIONAL.md',
            'MAPA_DE_MD.md'
        ];

        // 1. Check Required Files
        for (const file of requiredFiles) {
            if (!fs.existsSync(path.join(this.rootDir, file))) {
                issues.push(`CRITICAL: Missing core file: ${file}`);
            }
        }

        // 2. Verify Documentation Sync
        const mdFiles = this.getFiles(this.rootDir, '.md');
        const docSync = mdFiles.length > 5; // Heuristic: if we have more than 5 MD files, documentation exists.

        // 3. Structural Alignment
        const hasServices = fs.existsSync(path.join(this.rootDir, 'services'));
        const hasServer = fs.existsSync(path.join(this.rootDir, 'server'));
        const structuralAlignment = hasServices && hasServer;

        return {
            fileCount: mdFiles.length,
            documentationSync: docSync,
            structuralAlignment,
            issues
        };
    }

    private getFiles(dir: string, ext: string, files: string[] = []): string[] {
        if (!fs.existsSync(dir)) return files;
        const items = fs.readdirSync(dir);
        for (const item of items) {
            if (item === 'node_modules' || item === '.git') continue;
            const fullPath = path.join(dir, item);
            if (fs.statSync(fullPath).isDirectory()) {
                this.getFiles(fullPath, ext, files);
            } else if (item.endsWith(ext)) {
                files.push(fullPath);
            }
        }
        return files;
    }
}
