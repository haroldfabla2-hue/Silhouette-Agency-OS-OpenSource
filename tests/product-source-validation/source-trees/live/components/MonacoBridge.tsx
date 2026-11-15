import React, { useEffect, useRef } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { motion } from 'framer-motion';

interface MonacoBridgeProps {
    code: string;
    language: string;
    onChange: (value: string | undefined) => void;
    readOnly?: boolean;
    height?: string;
}

const MonacoBridge: React.FC<MonacoBridgeProps> = ({ code, language, onChange, readOnly = false, height = "100%" }) => {
    const monaco = useMonaco();

    useEffect(() => {
        if (monaco) {
            // Define "Neon Glass" Theme
            monaco.editor.defineTheme('neon-glass', {
                base: 'vs-dark',
                inherit: true,
                rules: [
                    { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
                    { token: 'keyword', foreground: 'ff79c6', fontStyle: 'bold' },
                    { token: 'string', foreground: 'f1fa8c' },
                    { token: 'number', foreground: 'bd93f9' },
                    { token: 'type', foreground: '8be9fd' },
                    { token: 'function', foreground: '50fa7b' },
                    { token: 'variable', foreground: 'f8f8f2' },
                    { token: 'delimiter', foreground: 'f8f8f2' },
                ],
                colors: {
                    'editor.background': '#0f172a00', // Transparent for glass effect
                    'editor.foreground': '#f8f8f2',
                    'editor.lineHighlightBackground': '#1e293b80',
                    'editorCursor.foreground': '#06b6d4',
                    'editorWhitespace.foreground': '#3b4252',
                    'editorIndentGuide.background': '#3b4252',
                    'editor.selectionBackground': '#06b6d440',
                }
            });
            monaco.editor.setTheme('neon-glass');
        }
    }, [monaco]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full h-full overflow-hidden rounded-md border border-slate-800/50 bg-slate-950/30 backdrop-blur-sm"
        >
            <Editor
                height={height}
                language={language}
                value={code}
                onChange={onChange}
                theme="neon-glass"
                options={{
                    readOnly,
                    minimap: { enabled: true, scale: 0.75 },
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                    fontLigatures: true,
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    cursorBlinking: 'smooth',
                    cursorSmoothCaretAnimation: 'on',
                    padding: { top: 16, bottom: 16 },
                    automaticLayout: true,
                    renderLineHighlight: 'all',
                    contextmenu: true,
                    scrollbar: {
                        useShadows: false,
                        verticalScrollbarSize: 10,
                        horizontalScrollbarSize: 10
                    }
                }}
            />
        </motion.div>
    );
};

export default MonacoBridge;
