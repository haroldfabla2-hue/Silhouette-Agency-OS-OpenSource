
import { exec } from 'child_process';
import util from 'util';
import path from 'path';

const execAsync = util.promisify(exec);

export class GitService {
    private workingDir: string;

    constructor(cwd: string = process.cwd()) {
        this.workingDir = cwd;
    }

    // --- CORE COMMANDS ---

    public async getCurrentBranch(): Promise<string> {
        try {
            const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: this.workingDir });
            return stdout.trim();
        } catch (e) {
            console.error('[GitService] Failed to get branch:', e);
            throw e;
        }
    }

    public async createBranch(branchName: string): Promise<void> {
        console.log(`[GitService] 🌿 Creating branch: ${branchName}`);
        await execAsync(`git checkout -b ${branchName}`, { cwd: this.workingDir });
    }

    public async checkout(branchName: string): Promise<void> {
        console.log(`[GitService] 🔄 Switching to branch: ${branchName}`);
        await execAsync(`git checkout ${branchName}`, { cwd: this.workingDir });
    }

    public async commit(message: string): Promise<void> {
        console.log(`[GitService] 💾 Committing: "${message}"`);
        await execAsync('git add .', { cwd: this.workingDir });
        await execAsync(`git commit -m "${message}"`, { cwd: this.workingDir });
    }

    public async merge(branchName: string): Promise<void> {
        console.log(`[GitService] 🔀 Merging ${branchName} into current branch...`);
        await execAsync(`git merge ${branchName}`, { cwd: this.workingDir });
    }

    public async deleteBranch(branchName: string, force: boolean = false): Promise<void> {
        console.log(`[GitService] 🗑️ Deleting branch: ${branchName}`);
        const flag = force ? '-D' : '-d';
        await execAsync(`git branch ${flag} ${branchName}`, { cwd: this.workingDir });
    }

    public async resetHard(target: string = 'HEAD'): Promise<void> {
        console.log(`[GitService] ↩️ Hard Reset to ${target}`);
        await execAsync(`git reset --hard ${target}`, { cwd: this.workingDir });
    }

    // --- SAFETY CHECKS ---

    public async isClean(): Promise<boolean> {
        const { stdout } = await execAsync('git status --porcelain', { cwd: this.workingDir });
        return stdout.trim().length === 0;
    }
}

export const gitService = new GitService();
