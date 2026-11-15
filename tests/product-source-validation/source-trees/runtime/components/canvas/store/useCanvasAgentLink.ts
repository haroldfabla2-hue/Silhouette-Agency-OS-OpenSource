import { useEffect } from 'react';
import { systemBus } from '../../../services/systemBus';
import { SystemProtocol } from '../../../types';
import { useCanvasStore } from './useCanvasStore';

export const useCanvasAgentLink = () => {
    const { createDocument, addLayer, setTool } = useCanvasStore();

    useEffect(() => {
        const unsubscribe = systemBus.subscribe(SystemProtocol.CANVAS_OPERATION as any, (message: any) => {
            console.log('[Visual Cortex] 🧠 Received agent instruction:', message);

            const { operation, params } = message.payload || {};

            switch (operation) {
                case 'CREATE_DOCUMENT':
                    createDocument(params.name || 'Agent Creation', params.width || 1024, params.height || 1024);
                    break;
                case 'ADD_LAYER':
                    addLayer(params.name, params.type);
                    break;
                case 'SET_TOOL':
                    setTool(params.tool);
                    break;
                // Add more agent capabilities here
            }
        });

        return () => unsubscribe();
    }, [createDocument, addLayer, setTool]);
};
