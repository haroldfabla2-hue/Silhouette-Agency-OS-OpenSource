/**
 * SELF-EVOLUTION ROUTES
 * ═══════════════════════════════════════════════════════════════
 * API endpoints for Silhouette's self-modification capabilities.
 */

import { Router, Request, Response } from 'express';
import { prReviewService } from '../../services/prReviewService';
import { vfs } from '../../../services/virtualFileSystem';

const router = Router();

/**
 * GET /api/v1/self-evolution/pending-prs
 * Returns all pending PRs from Silhouette that need review
 */
router.get('/pending-prs', async (req: Request, res: Response) => {
    try {
        const forceRefresh = req.query.refresh === 'true';
        const prs = await prReviewService.getPendingPRs(forceRefresh);

        res.json({
            success: true,
            count: prs.length,
            prs: prs.map(pr => ({
                number: pr.number,
                title: pr.title,
                url: pr.url,
                ciStatus: pr.ciStatus,
                draft: pr.draft,
                additions: pr.additions,
                deletions: pr.deletions,
                filesChanged: pr.changedFiles.length,
                createdAt: pr.createdAt,
                updatedAt: pr.updatedAt
            }))
        });
    } catch (error: any) {
        console.error('[SELF-EVOLUTION] Error fetching pending PRs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/v1/self-evolution/pr/:prNumber
 * Get detailed info about a specific PR
 */
router.get('/pr/:prNumber', async (req: Request, res: Response) => {
    try {
        const prNumber = parseInt(req.params.prNumber, 10);
        const prs = await prReviewService.getPendingPRs();
        const pr = prs.find(p => p.number === prNumber);

        if (!pr) {
            return res.status(404).json({ success: false, error: 'PR not found' });
        }

        // Get full project data including file contents
        const projectData = await prReviewService.createVFSProjectData(pr);

        res.json({
            success: true,
            pr: {
                ...pr,
                explanation: projectData.explanation,
                files: projectData.files
            }
        });
    } catch (error: any) {
        console.error('[SELF-EVOLUTION] Error fetching PR details:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/v1/self-evolution/ingest/:prNumber
 * Creates a VFS project from the PR for review in DynamicWorkspace
 */
router.post('/ingest/:prNumber', async (req: Request, res: Response) => {
    try {
        const prNumber = parseInt(req.params.prNumber, 10);
        const prs = await prReviewService.getPendingPRs();
        const pr = prs.find(p => p.number === prNumber);

        if (!pr) {
            return res.status(404).json({ success: false, error: 'PR not found' });
        }

        const projectData = await prReviewService.createVFSProjectData(pr);

        // Create VFS project structure
        const projectName = `[PR #${prNumber}] ${pr.title.substring(0, 30)}`;

        // Build file structure for VFS ingestion
        const structure = {
            root: [
                {
                    type: 'FILE',
                    name: '__PR_INFO__.md',
                    content: generatePRInfoMarkdown(pr, projectData.explanation || '')
                },
                {
                    type: 'FOLDER',
                    name: 'proposed',
                    children: projectData.files.map(f => ({
                        type: 'FILE',
                        name: f.path.split('/').pop() || f.path,
                        content: f.proposed
                    }))
                },
                {
                    type: 'FOLDER',
                    name: 'original',
                    children: projectData.files.map(f => ({
                        type: 'FILE',
                        name: f.path.split('/').pop() || f.path,
                        content: f.original
                    }))
                },
                {
                    type: 'FOLDER',
                    name: 'diff',
                    children: projectData.files.map(f => ({
                        type: 'FILE',
                        name: `${f.path.split('/').pop() || f.path}.diff`,
                        content: f.diff
                    }))
                }
            ]
        };

        // Ingest into VFS
        const projectId = vfs.ingestProjectStructure(projectName, structure);

        res.json({
            success: true,
            projectId,
            projectName,
            message: `PR #${prNumber} loaded into workspace`
        });

    } catch (error: any) {
        console.error('[SELF-EVOLUTION] Error ingesting PR:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/v1/self-evolution/approve/:prNumber
 * Approves and merges a PR
 */
router.post('/approve/:prNumber', async (req: Request, res: Response) => {
    try {
        const prNumber = parseInt(req.params.prNumber, 10);
        const result = await prReviewService.approvePR(prNumber);

        if (result.success) {
            // Clean up VFS project if exists
            const projects = vfs.getProjects();
            const prProject = projects.find(p => p.name.includes(`[PR #${prNumber}]`));
            if (prProject) {
                vfs.deleteProject(prProject.id);
            }
        }

        res.json(result);
    } catch (error: any) {
        console.error('[SELF-EVOLUTION] Error approving PR:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/v1/self-evolution/reject/:prNumber
 * Rejects and closes a PR
 */
router.post('/reject/:prNumber', async (req: Request, res: Response) => {
    try {
        const prNumber = parseInt(req.params.prNumber, 10);
        const { reason } = req.body;

        const result = await prReviewService.rejectPR(prNumber, reason);

        if (result.success) {
            // Clean up VFS project if exists
            const projects = vfs.getProjects();
            const prProject = projects.find(p => p.name.includes(`[PR #${prNumber}]`));
            if (prProject) {
                vfs.deleteProject(prProject.id);
            }
        }

        res.json(result);
    } catch (error: any) {
        console.error('[SELF-EVOLUTION] Error rejecting PR:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/v1/self-evolution/explain/:prNumber
 * Generates an explanation for a PR using LLM
 */
router.post('/explain/:prNumber', async (req: Request, res: Response) => {
    try {
        const prNumber = parseInt(req.params.prNumber, 10);
        const prs = await prReviewService.getPendingPRs();
        const pr = prs.find(p => p.number === prNumber);

        if (!pr) {
            return res.status(404).json({ success: false, error: 'PR not found' });
        }

        const explanation = await prReviewService.generateExplanation(pr);

        res.json({
            success: true,
            explanation
        });
    } catch (error: any) {
        console.error('[SELF-EVOLUTION] Error generating explanation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Helper: Generate markdown content for __PR_INFO__.md
 */
function generatePRInfoMarkdown(pr: any, explanation: string): string {
    const ciStatusEmoji = pr.ciStatus === 'success' ? '✅' :
        pr.ciStatus === 'failure' ? '❌' :
            pr.ciStatus === 'pending' ? '⏳' : '❓';

    return `# 🔧 Auto-Modificación #${pr.number}

## ${pr.title}

---

| Propiedad | Valor |
|-----------|-------|
| **CI Status** | ${ciStatusEmoji} ${pr.ciStatus} |
| **Archivos** | ${pr.changedFiles.length} |
| **Líneas** | +${pr.additions}, -${pr.deletions} |
| **Creado** | ${new Date(pr.createdAt).toLocaleString()} |
| **URL** | [Ver en GitHub](${pr.url}) |

---

## 💭 Explicación de Silhouette

${explanation}

---

## 📁 Archivos Modificados

${pr.changedFiles.map((f: any) => `- \`${f.filename}\`: +${f.additions}, -${f.deletions} (${f.status})`).join('\n')}

---

## 📋 Instrucciones de Revisión

1. **Revisar cambios**: Abre los archivos en \`proposed/\` y compáralos con \`original/\`
2. **Ver diffs**: Los archivos en \`diff/\` muestran los cambios exactos
3. **Hacer preguntas**: Pregunta a Silhouette en el chat sobre cualquier duda
4. **Aprobar o Rechazar**: Usa los botones en la barra de herramientas

---

> ⚠️ **Nota**: Este proyecto se creó automáticamente y se eliminará después de aprobar o rechazar el PR.
`;
}

export default router;
