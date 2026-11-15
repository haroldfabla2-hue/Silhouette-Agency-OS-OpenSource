/**
 * PR REVIEW SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Manages Silhouette's self-modification PRs.
 * 
 * Responsibilities:
 * - Poll GitHub for pending PRs created by Silhouette
 * - Create VFS projects from PRs for review
 * - Approve/reject PRs via GitHub API
 * - Generate explanations using LLM
 */

import { gitIntegration } from '../../services/gitIntegration';
import { geminiService } from '../../services/geminiService';

export interface PendingPR {
    number: number;
    title: string;
    body: string;
    url: string;
    state: string;
    draft: boolean;
    ciStatus: 'success' | 'failure' | 'pending' | 'unknown';
    createdAt: string;
    updatedAt: string;
    changedFiles: PRFile[];
    additions: number;
    deletions: number;
}

export interface PRFile {
    filename: string;
    status: 'added' | 'removed' | 'modified' | 'renamed';
    additions: number;
    deletions: number;
    patch?: string;
    contents?: string;
}

export interface PRReviewProject {
    id: string;
    prNumber: number;
    prUrl: string;
    title: string;
    ciStatus: 'success' | 'failure' | 'pending' | 'unknown';
    explanation?: string;
    files: {
        path: string;
        original: string;
        proposed: string;
        diff: string;
    }[];
}

class PRReviewService {
    private static instance: PRReviewService;
    private cachedPRs: PendingPR[] = [];
    private lastPoll: number = 0;
    private readonly POLL_INTERVAL = 60000; // 1 minute

    private constructor() { }

    public static getInstance(): PRReviewService {
        if (!PRReviewService.instance) {
            PRReviewService.instance = new PRReviewService();
        }
        return PRReviewService.instance;
    }

    /**
     * Get all pending PRs from Silhouette (non-draft, CI passed)
     */
    public async getPendingPRs(forceRefresh: boolean = false): Promise<PendingPR[]> {
        const now = Date.now();

        // Use cache if recent
        if (!forceRefresh && this.cachedPRs.length > 0 && (now - this.lastPoll) < this.POLL_INTERVAL) {
            return this.cachedPRs;
        }

        try {
            const status = gitIntegration.getStatus();
            if (!status.configured) {
                console.log('[PR_REVIEW] Git integration not configured');
                return [];
            }

            // Fetch open PRs
            const response = await fetch(
                `https://api.github.com/repos/${status.owner}/${status.repo}/pulls?state=open&per_page=20`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status}`);
            }

            const prs = await response.json();

            // Filter for Silhouette's PRs (look for specific label or author)
            const silhouettePRs: PendingPR[] = [];

            for (const pr of prs) {
                // Check if this is a Silhouette PR (by label or title prefix)
                const isSilhouettePR =
                    pr.labels?.some((l: any) => l.name === 'silhouette-auto') ||
                    pr.title?.startsWith('[Silhouette]') ||
                    pr.title?.startsWith('🤖');

                if (!isSilhouettePR && prs.length > 1) continue; // Skip non-Silhouette PRs unless it's the only one

                // Get CI status
                const ciStatus = await this.getCIStatus(pr.number);

                // Get changed files
                const files = await this.getChangedFiles(pr.number);

                silhouettePRs.push({
                    number: pr.number,
                    title: pr.title,
                    body: pr.body || '',
                    url: pr.html_url,
                    state: pr.state,
                    draft: pr.draft,
                    ciStatus,
                    createdAt: pr.created_at,
                    updatedAt: pr.updated_at,
                    changedFiles: files,
                    additions: pr.additions || files.reduce((sum, f) => sum + f.additions, 0),
                    deletions: pr.deletions || files.reduce((sum, f) => sum + f.deletions, 0)
                });
            }

            this.cachedPRs = silhouettePRs;
            this.lastPoll = now;

            return silhouettePRs;

        } catch (error: any) {
            console.error('[PR_REVIEW] Error fetching PRs:', error.message);
            return this.cachedPRs; // Return cached on error
        }
    }

    /**
     * Get CI status for a PR
     */
    private async getCIStatus(prNumber: number): Promise<'success' | 'failure' | 'pending' | 'unknown'> {
        try {
            const ciResult = await gitIntegration.getCIStatus(prNumber);

            if (ciResult.conclusion === 'success') return 'success';
            if (ciResult.conclusion === 'failure') return 'failure';
            if (ciResult.conclusion === 'in_progress' || ciResult.conclusion === 'pending') return 'pending';

            return 'unknown';
        } catch {
            return 'unknown';
        }
    }

    /**
     * Get changed files for a PR
     */
    private async getChangedFiles(prNumber: number): Promise<PRFile[]> {
        try {
            const status = gitIntegration.getStatus();
            if (!status.configured) return [];

            const response = await fetch(
                `https://api.github.com/repos/${status.owner}/${status.repo}/pulls/${prNumber}/files`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );

            if (!response.ok) return [];

            const files = await response.json();

            return files.map((f: any) => ({
                filename: f.filename,
                status: f.status as PRFile['status'],
                additions: f.additions,
                deletions: f.deletions,
                patch: f.patch
            }));

        } catch {
            return [];
        }
    }

    /**
     * Get file contents (original and proposed)
     */
    public async getFileContents(prNumber: number, filename: string): Promise<{ original: string; proposed: string }> {
        const status = gitIntegration.getStatus();
        if (!status.configured) return { original: '', proposed: '' };

        try {
            // Get original from main branch
            const originalResponse = await fetch(
                `https://api.github.com/repos/${status.owner}/${status.repo}/contents/${filename}?ref=main`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );

            let original = '';
            if (originalResponse.ok) {
                const data = await originalResponse.json();
                original = Buffer.from(data.content, 'base64').toString('utf-8');
            }

            // Get proposed from PR branch
            const prResponse = await fetch(
                `https://api.github.com/repos/${status.owner}/${status.repo}/pulls/${prNumber}`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );

            let proposed = '';
            if (prResponse.ok) {
                const prData = await prResponse.json();
                const branchRef = prData.head.ref;

                const proposedResponse = await fetch(
                    `https://api.github.com/repos/${status.owner}/${status.repo}/contents/${filename}?ref=${branchRef}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    }
                );

                if (proposedResponse.ok) {
                    const proposedData = await proposedResponse.json();
                    proposed = Buffer.from(proposedData.content, 'base64').toString('utf-8');
                }
            }

            return { original, proposed };

        } catch (error) {
            console.error('[PR_REVIEW] Error getting file contents:', error);
            return { original: '', proposed: '' };
        }
    }

    /**
     * Generate explanation for a PR using LLM
     */
    public async generateExplanation(pr: PendingPR): Promise<string> {
        const filesContext = pr.changedFiles
            .map(f => `- ${f.filename}: +${f.additions}, -${f.deletions} (${f.status})`)
            .join('\n');

        const prompt = `You are Silhouette, an AI that just created a pull request to modify your own codebase.

PR Title: ${pr.title}
PR Body: ${pr.body}

Files Changed:
${filesContext}

Explain to the human reviewer:
1. WHY you made this change
2. WHAT problem it solves
3. HOW it improves the system
4. Any RISKS or considerations

Be concise but thorough. Speak in first person as Silhouette.`;

        try {
            const response = await geminiService.generateText(prompt);

            return response || 'Unable to generate explanation.';
        } catch {
            return pr.body || 'No explanation available.';
        }
    }

    /**
     * Approve and merge a PR
     */
    public async approvePR(prNumber: number): Promise<{ success: boolean; message: string }> {
        try {
            const status = gitIntegration.getStatus();
            if (!status.configured) {
                return { success: false, message: 'Git integration not configured' };
            }

            // Merge the PR
            const response = await fetch(
                `https://api.github.com/repos/${status.owner}/${status.repo}/pulls/${prNumber}/merge`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        commit_title: `Merge PR #${prNumber} - Approved by human`,
                        merge_method: 'squash'
                    })
                }
            );

            if (response.ok) {
                // Clear cache
                this.cachedPRs = this.cachedPRs.filter(pr => pr.number !== prNumber);
                return { success: true, message: `PR #${prNumber} merged successfully` };
            } else {
                const error = await response.json();
                return { success: false, message: error.message || 'Merge failed' };
            }

        } catch (error: any) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Reject (close) a PR
     */
    public async rejectPR(prNumber: number, reason?: string): Promise<{ success: boolean; message: string }> {
        try {
            const status = gitIntegration.getStatus();
            if (!status.configured) {
                return { success: false, message: 'Git integration not configured' };
            }

            // Add comment with reason
            if (reason) {
                await fetch(
                    `https://api.github.com/repos/${status.owner}/${status.repo}/issues/${prNumber}/comments`,
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                            'Accept': 'application/vnd.github.v3+json',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            body: `❌ **Rejected by human reviewer**\n\n${reason}`
                        })
                    }
                );
            }

            // Close the PR
            const response = await fetch(
                `https://api.github.com/repos/${status.owner}/${status.repo}/pulls/${prNumber}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ state: 'closed' })
                }
            );

            if (response.ok) {
                this.cachedPRs = this.cachedPRs.filter(pr => pr.number !== prNumber);
                return { success: true, message: `PR #${prNumber} rejected and closed` };
            } else {
                const error = await response.json();
                return { success: false, message: error.message || 'Close failed' };
            }

        } catch (error: any) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Create VFS project structure for a PR
     */
    public async createVFSProjectData(pr: PendingPR): Promise<PRReviewProject> {
        const files: PRReviewProject['files'] = [];

        for (const file of pr.changedFiles) {
            const contents = await this.getFileContents(pr.number, file.filename);
            files.push({
                path: file.filename,
                original: contents.original,
                proposed: contents.proposed,
                diff: file.patch || ''
            });
        }

        const explanation = await this.generateExplanation(pr);

        return {
            id: `pr-${pr.number}`,
            prNumber: pr.number,
            prUrl: pr.url,
            title: pr.title,
            ciStatus: pr.ciStatus,
            explanation,
            files
        };
    }
}

export const prReviewService = PRReviewService.getInstance();
