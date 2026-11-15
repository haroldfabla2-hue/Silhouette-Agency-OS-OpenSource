import React from 'react';

interface TerminalBlockProps {
    content: string;
}

/**
 * Rich Terminal Component
 * Displays command-line output in a styled terminal window
 * Extracted from ChatWidget for better code organization
 */
const TerminalBlock: React.FC<TerminalBlockProps> = ({ content }) => {
    // Format: <<<TERMINAL (cmd="git status")>>> \n output \n <<<END>>>
    // Or just <<<TERMINAL>>> cmd \n output <<<END>>>

    // Naive parse: Strip tags
    const raw = content.replace(/<<<TERMINAL.*?>/g, '').replace(/<<<END>>>/g, '').trim();
    const lines = raw.split('\n');
    const cmd = lines[0]?.startsWith('$') ? lines[0] : `$ ${lines[0]}`; // Guess command
    const output = lines.slice(1).join('\n');

    return (
        <div className="my-3 rounded-md overflow-hidden bg-[#1e1e1e] border border-slate-700 shadow-lg font-mono text-xs w-full">
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#252526] border-b border-[#333]">
                <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]"></div>
                </div>
                <div className="text-slate-400 text-[10px]">bash</div>
            </div>
            <div className="p-3 text-slate-300 whitespace-pre-wrap overflow-x-auto">
                <div className="text-cyan-400 font-bold mb-1">{cmd}</div>
                <div className="opacity-80">{output}</div>
            </div>
        </div>
    );
};

export default TerminalBlock;
