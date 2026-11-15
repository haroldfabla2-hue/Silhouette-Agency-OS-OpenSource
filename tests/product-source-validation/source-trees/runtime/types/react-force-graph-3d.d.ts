declare module 'react-force-graph-3d' {
    import * as React from 'react';

    export interface ForceGraph3DProps {
        graphData?: {
            nodes: any[];
            links: any[];
        };
        width?: number;
        height?: number;
        backgroundColor?: string;
        showNavInfo?: boolean;
        nodeRelSize?: number;
        nodeLabel?: string | ((node: any) => string);
        nodeAutoColorBy?: string | ((node: any) => string);
        linkDirectionalArrowLength?: number;
        linkDirectionalArrowRelPos?: number;
        enableNodeDrag?: boolean;
        onEngineStop?: () => void;
        ref?: any;
        [key: string]: any;
    }

    const ForceGraph3D: React.FC<ForceGraph3DProps>;
    export default ForceGraph3D;
}
