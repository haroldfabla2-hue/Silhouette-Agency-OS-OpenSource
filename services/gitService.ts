
import { execFile } from 'child_process';
import util from 'util';

const execFileAsync = util.promisify(execFile);

/**
 * Thin git wrapper.
 *
 * SECURITY: all commands are executed via execFile with an argv array (no shell),
 * so branch names / commit messages can never break out into shell injection
 * (the previous implementation interpolated user-controlled strings into a
 * shell command string).
 */
export class GitService {
    private workingDir: string;

    constructor(cwd: string = process.cwd()) {
        this.workingDir = cwd;
    }

    private async git(args: string[]): Promise<string> {
        const { stdout } = await execFileAsync('git', args, { cwd: this.workingDir });
        return stdout;
    }

    // --- CORE COMMANDS ---

    public async getCurrentBranch(): Promise<string> {
        try {
            return (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
        } catch (e) {
            console.error('[GitService] Failed to get branch:', e);
            throw e;
        }
    }

    public async createBranch(branchName: string): Promise<void> {
        console.log(`[GitService] 🌿 Creating branch: ${branchName}`);
        await this.git(['checkout', '-b', branchName]);
    }

    public async checkout(branchName: string): Promise<void> {
        console.log(`[GitService] 🔄 Switching to branch: ${branchName}`);
        await this.git(['checkout', branchName]);
    }

    public async commit(message: string): Promise<void> {
        console.log(`[GitService] 💾 Committing: "${message}"`);
        await this.git(['add', '.']);
        // `-m message` as separate argv entries — message is never shell-parsed.
        await this.git(['commit', '-m', message]);
    }

    public async merge(branchName: string): Promise<void> {
        console.log(`[GitService] 🔀 Merging ${branchName} into current branch...`);
        await this.git(['merge', branchName]);
    }

    public async deleteBranch(branchName: string, force: boolean = false): Promise<void> {
        console.log(`[GitService] 🗑️ Deleting branch: ${branchName}`);
        await this.git(['branch', force ? '-D' : '-d', branchName]);
    }

    public async resetHard(target: string = 'HEAD'): Promise<void> {
        console.log(`[GitService] ↩️ Hard Reset to ${target}`);
        await this.git(['reset', '--hard', target]);
    }

    // --- SAFETY CHECKS ---

    public async isClean(): Promise<boolean> {
        const stdout = await this.git(['status', '--porcelain']);
        return stdout.trim().length === 0;
    }
}

export const gitService = new GitService();
