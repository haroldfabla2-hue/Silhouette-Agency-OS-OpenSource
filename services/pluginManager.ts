import { generateAgentResponse } from './geminiService';
import { IntrospectionLayer, WorkflowStage } from '../types';

export interface SilhouettePlugin {
    id: string;
    appName: string;
    capabilities: ('CHAT' | 'READ' | 'WRITE' | 'ADMIN')[];
    script: string;
}

export const pluginManager = {
    /**
     * Generates a custom JavaScript SDK (plugin) for an external application.
     * This script allows the external app to connect to Silhouette via Neuro-Link.
     */
    generatePlugin: async (appName: string, contextDescription: string, capabilities: string[]): Promise<SilhouettePlugin> => {
        const prompt = `
        You are the Architect of the Silhouette Neuro-Link.
        I need you to generate a standalone JavaScript SDK (plugin) that can be embedded into an external web application ("${appName}").
        
        Context of External App: "${contextDescription}"
        Requested Capabilities: ${capabilities.join(', ')}
        
        The script must:
        1. Initialize a connection to the Silhouette Neuro-Link (WebSocket or HTTP polling).
        2. Expose a global object 'window.Silhouette' with methods corresponding to the capabilities.
        3. If CHAT is enabled, inject a floating chat widget into the DOM.
        4. If READ is enabled, observe DOM changes and report relevant data.
        5. Be self-contained and robust (handle connection failures).
        
        Return ONLY the raw JavaScript code for this plugin. No markdown.
        `;

        const response = await generateAgentResponse(
            "Plugin_Architect",
            "Integration Specialist",
            "CORE",
            prompt,
            null,
            IntrospectionLayer.DEEP,
            WorkflowStage.EXECUTION,
            { id: 'system' }
        );

        let script = response.output;
        // Cleanup markdown if present
        script = script.replace(/```javascript/g, '').replace(/```/g, '').trim();

        return {
            id: crypto.randomUUID(),
            appName,
            capabilities: capabilities as any,
            script
        };
    }
};
