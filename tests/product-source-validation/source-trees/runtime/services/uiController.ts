/**
 * UI CONTROLLER SERVICE
 * Enables Silhouette to control the frontend UI
 * Communicates via SSE events to the frontend
 */

import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';

export type UIDestination =
    'dashboard' | 'chat' | 'orchestrator' | 'canvas' | 'media' | 'system' |
    'memory' | 'settings' | 'introspection' | 'workspace' | 'training' | 'terminal';

export type UIAction =
    'open_panel' | 'close_panel' | 'click_button' | 'highlight' | 'scroll_to' | 'show_tooltip';

export type UIPanel = 'drive' | 'email' | 'notifications' | 'settings';

interface NavigationCommand {
    type: 'NAVIGATE';
    destination: UIDestination;
    highlightElement?: string;
    message?: string;
}

interface ActionCommand {
    type: 'ACTION';
    action: UIAction;
    target?: string;
    panel?: UIPanel;
    message?: string;
    durationMs?: number;
}

export type UICommand = NavigationCommand | ActionCommand;

class UIController {
    private static instance: UIController;
    private commandQueue: UICommand[] = [];

    private constructor() {
        console.log('[UI_CONTROLLER] 🎮 Initialized');
    }

    public static getInstance(): UIController {
        if (!UIController.instance) {
            UIController.instance = new UIController();
        }
        return UIController.instance;
    }

    /**
     * Navigate to a specific section of the app
     */
    public navigateTo(destination: UIDestination, options?: {
        highlightElement?: string;
        message?: string;
    }): { success: boolean; message: string } {

        const command: NavigationCommand = {
            type: 'NAVIGATE',
            destination,
            highlightElement: options?.highlightElement,
            message: options?.message
        };

        // Emit via SystemBus - frontend will listen
        systemBus.emit(SystemProtocol.UI_REFRESH, {
            uiCommand: command,
            timestamp: Date.now()
        }, 'UI_CONTROLLER');

        console.log(`[UI_CONTROLLER] 🧭 Navigate to: ${destination}`);

        return {
            success: true,
            message: `Navigating to ${destination}${options?.message ? `: ${options.message}` : ''}`
        };
    }

    /**
     * Perform a UI action (open panel, highlight, etc)
     */
    public performAction(action: UIAction, options?: {
        target?: string;
        panel?: UIPanel;
        message?: string;
        durationMs?: number;
    }): { success: boolean; message: string } {

        const command: ActionCommand = {
            type: 'ACTION',
            action,
            target: options?.target,
            panel: options?.panel,
            message: options?.message,
            durationMs: options?.durationMs || 3000
        };

        // Emit via SystemBus
        systemBus.emit(SystemProtocol.UI_REFRESH, {
            uiCommand: command,
            timestamp: Date.now()
        }, 'UI_CONTROLLER');

        console.log(`[UI_CONTROLLER] 🎬 Action: ${action}`, options);

        return {
            success: true,
            message: `Performed UI action: ${action}${options?.panel ? ` on ${options.panel}` : ''}`
        };
    }

    /**
     * Show a guided tooltip to the user
     */
    public showTooltip(target: string, message: string, durationMs: number = 3000): { success: boolean; message: string } {
        return this.performAction('show_tooltip', { target, message, durationMs });
    }

    /**
     * Highlight an element on the page
     */
    public highlight(target: string, durationMs: number = 3000): { success: boolean; message: string } {
        return this.performAction('highlight', { target, durationMs });
    }

    /**
     * Open a panel (Drive, Email, etc)
     */
    public openPanel(panel: UIPanel): { success: boolean; message: string } {
        return this.performAction('open_panel', { panel });
    }

    /**
     * Close a panel
     */
    public closePanel(panel: UIPanel): { success: boolean; message: string } {
        return this.performAction('close_panel', { panel });
    }
}

export const uiController = UIController.getInstance();
