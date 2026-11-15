
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { generateAgentResponse } from './geminiService';
import { IntrospectionLayer, WorkflowStage, GenesisProject } from '../types';
import { neuroLink } from './neuroLinkService';
import { factoryEvents } from '../server/controllers/factoryController';
import { sqliteService } from './sqliteService';

export class GenesisService {

    public async spawnProject(params: any): Promise<GenesisProject | null> {
        const { name, template, gitUser, gitToken, repoUrl, description } = params;

        // Fetch config
        const genesisConfig = sqliteService.getConfig('genesisConfig') || {
            workspaceRoot: './workspace',
            allowBridgeInjection: true
        };
        const rootDir = process.cwd();
        const wsPath = path.join(rootDir, genesisConfig.workspaceRoot);
        const projectPath = path.join(wsPath, name);

        // Validation
        if (!fs.existsSync(wsPath)) fs.mkdirSync(wsPath, { recursive: true });
        if (fs.existsSync(projectPath)) {
            throw new Error(`Project '${name}' already exists.`);
        }

        const newProject: GenesisProject = {
            id: crypto.randomUUID(),
            name,
            description,
            path: projectPath,
            template,
            status: 'CREATING',
            bridgeStatus: 'DISCONNECTED',
            createdAt: Date.now()
        };

        // Persist Initial State
        const projects = sqliteService.getConfig('genesisProjects') || [];
        projects.push(newProject);
        sqliteService.setConfig('genesisProjects', projects);

        // ASYNC PROCESS START
        this.runSpawnProcess(newProject, params, genesisConfig, projectPath, wsPath);

        return newProject;
    }

    private async runSpawnProcess(project: GenesisProject, params: any, config: any, projectPath: string, wsPath: string) {
        const { name, template, repoUrl, gitToken, gitUser, description } = params;
        const log = (msg: string) => {
            console.log(`[GENESIS] ${msg}`);
            factoryEvents.emit('log', msg);
        };

        log(`Spawning ${name} in ${projectPath}...`);

        let templateToUse = template;

        // AI AUTO-DETECT LOGIC
        if (template === 'AI_AUTO_DETECT' && description) {
            log("🤖 Initiating Genesis Protocol: Swarm Intelligence Active...");
            try {
                log("👤 Product Owner (MARKETING) is analyzing requirements...");
                const poAnalysis = await generateAgentResponse(
                    "Product_Owner", "Product Manager", "MARKETING",
                    `Analyze this project request and define key requirements. Request: "${description}"`,
                    null, IntrospectionLayer.SHALLOW, WorkflowStage.PLANNING, { id: 'system' }
                );

                log("👨‍💻 Tech Lead (DEV) is reviewing PO specs...");
                const techDecision = await generateAgentResponse(
                    "Tech_Lead", "Senior Architect", "DEV",
                    `Select best stack (REACT_VITE or NEXT_JS) based on: "${poAnalysis.output}". Return ONLY value.`,
                    null, IntrospectionLayer.SHALLOW, WorkflowStage.PLANNING, { id: 'system' }
                );

                const decision = techDecision.output.trim();
                if (decision.includes('NEXT_JS')) templateToUse = 'NEXT_JS';
                else if (decision.includes('REACT_VITE')) templateToUse = 'REACT_VITE';
                log(`🎯 Final Consensus: ${templateToUse}`);
            } catch (e) {
                log("⚠️ Swarm Consensus failed, defaulting to REACT_VITE");
                templateToUse = 'REACT_VITE';
            }
        }

        // SCAFFOLDING
        const templateFlag = templateToUse === 'REACT_VITE' ? '--template react' : '';
        const createCmd = templateToUse === 'NEXT_JS'
            ? `npx create-next-app@latest ${name} --typescript --tailwind --eslint --no-src-dir --import-alias "@/*" --use-npm`
            : `npm create vite@latest ${name} -- ${templateFlag} -y`;

        log(`Executing: ${createCmd}`);

        exec(createCmd, { cwd: wsPath }, (error) => {
            if (error) {
                log(`Spawn Error: ${error.message}`);
                this.updateProjectStatus(project.id, 'ERROR');
                return;
            }
            log("Scaffolding complete. Installing dependencies...");

            exec(`npm install`, { cwd: projectPath }, (error) => {
                log("Dependencies installed.");

                // NEURO-LINK INJECTION
                if (config.allowBridgeInjection) {
                    try {
                        const sdkCode = neuroLink.getSDKCode(name.toLowerCase());
                        const indexPath = path.join(projectPath, templateToUse === 'NEXT_JS' ? 'app/layout.tsx' : 'index.html');
                        if (fs.existsSync(indexPath)) {
                            let content = fs.readFileSync(indexPath, 'utf-8');
                            if (templateToUse === 'NEXT_JS') {
                                log("Neuro-Link injection for Next.js pending implementation.");
                            } else {
                                content = content.replace('</body>', `<script>${sdkCode}</script></body>`);
                                fs.writeFileSync(indexPath, content);
                                log("Neuro-Link SDK injected.");
                            }
                        }
                    } catch (err) { console.error("SDK Injection Failed", err); }
                }

                // GIT INIT
                log("Initializing Git Repository...");
                exec(`git init && git add . && git commit -m "Initial commit by Silhouette Genesis"`, { cwd: projectPath }, (err) => {
                    log("Git initialized.");

                    if (repoUrl) {
                        log(`Pushing to remote: ${repoUrl}`);
                        let remote = repoUrl;
                        if (gitToken && gitUser) remote = repoUrl.replace('https://', `https://${gitUser}:${gitToken}@`);

                        exec(`git remote add origin ${remote} && git branch -M main && git push -u origin main`, { cwd: projectPath }, (err) => {
                            if (err) log(`Git Push Failed: ${err.message}`);
                            else log("Pushed to remote.");
                            this.updateProjectStatus(project.id, 'READY', 'CONNECTED', repoUrl);
                        });
                    } else {
                        this.updateProjectStatus(project.id, 'READY', 'CONNECTED');
                        log(`Project ${name} is READY (Local).`);
                    }
                });
            });
        });
    }

    private updateProjectStatus(id: string, status: any, bridgeStatus?: any, repoUrl?: string) {
        const projects = sqliteService.getConfig('genesisProjects') || [];
        const p = projects.find((pr: any) => pr.id === id);
        if (p) {
            p.status = status;
            if (bridgeStatus) p.bridgeStatus = bridgeStatus;
            if (repoUrl) p.repoUrl = repoUrl;
            sqliteService.setConfig('genesisProjects', projects);
        }
    }
}

export const genesisService = new GenesisService();
