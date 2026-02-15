
import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { generateAgentResponse, generateAgentResponseStream } from '../../services/geminiService';
import { IntrospectionLayer, WorkflowStage, GenesisProject, UserRole } from '../../types';
import { neuroLink } from '../../services/neuroLinkService';
import { systemBus } from '../../services/systemBus';
import { SystemProtocol } from '../../types';
import { sqliteService } from '../../services/sqliteService';

export const factoryEvents = new EventEmitter();

// --- GLOBAL BUS BRIDGE ---
systemBus.subscribe(SystemProtocol.UI_REFRESH, (e) => factoryEvents.emit('bus_event', e));
systemBus.subscribe(SystemProtocol.COST_ANOMALY, (e) => factoryEvents.emit('bus_event', e));
systemBus.subscribe(SystemProtocol.TASK_PAUSED, (e) => factoryEvents.emit('bus_event', e));
systemBus.subscribe(SystemProtocol.THOUGHT_EMISSION, (e) => factoryEvents.emit('bus_event', e));
systemBus.subscribe(SystemProtocol.MEMORY_CREATED, (e) => factoryEvents.emit('bus_event', e));
systemBus.subscribe(SystemProtocol.INTUITION_CONSOLIDATED, (e) => factoryEvents.emit('bus_event', e));
systemBus.subscribe(SystemProtocol.VISUAL_REQUEST, (e) => factoryEvents.emit('bus_event', e));
systemBus.subscribe(SystemProtocol.GENESIS_UPDATE, (e) => factoryEvents.emit('bus_event', e)); // Projects real-time
systemBus.subscribe(SystemProtocol.NARRATIVE_UPDATE, (e) => factoryEvents.emit('bus_event', e)); // Unified Stream

export class FactoryController {

    public streamEvents(req: Request, res: Response) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const sendEvent = (data: any) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        const logHandler = (log: string) => sendEvent({ type: 'LOG', message: log });
        const busHandler = (event: any) => sendEvent({ type: event.type, payload: event.payload });

        factoryEvents.on('log', logHandler);
        factoryEvents.on('bus_event', busHandler);

        const interval = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 15000);

        req.on('close', () => {
            clearInterval(interval);
            factoryEvents.off('log', logHandler);
            factoryEvents.off('bus_event', busHandler);
        });
    }

    public async legacySpawnProject(req: Request, res: Response) {
        try {
            const { genesisService } = await import('../../services/genesisService');
            const project = await genesisService.spawnProject(req.body);
            res.json({ success: true, project });
        } catch (e: any) {
            console.error("Spawn Error", e);
            if (!res.headersSent) res.status(500).json({ error: e.message || "Spawn failed" });
        }
    }

    public listProjects(req: Request, res: Response) {
        const projects = sqliteService.getConfig('genesisProjects') || [];
        res.json(projects);
    }

    public getConfig(req: Request, res: Response) {
        const config = sqliteService.getConfig('genesisConfig') || { workspaceRoot: './workspace' };
        res.json(config);
    }

    public async updateConfig(req: Request, res: Response) {
        const { config } = req.body;
        let currentConfig = sqliteService.getConfig('genesisConfig') || { workspaceRoot: './workspace' };
        currentConfig = { ...currentConfig, ...config };

        // Ensure workspace exists if root changed
        const rootDir = process.cwd();
        const wsPath = path.join(rootDir, currentConfig.workspaceRoot);
        if (!fs.existsSync(wsPath)) {
            fs.mkdirSync(wsPath, { recursive: true });
        }

        sqliteService.setConfig('genesisConfig', currentConfig);
        res.json({ success: true, config: currentConfig });
    }
}

export const factoryController = new FactoryController();

