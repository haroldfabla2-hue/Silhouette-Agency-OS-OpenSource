/**
 * FileCard - Document/Code Preview Component
 * 
 * Features:
 * - File type icon
 * - Size badge
 * - Preview for code/text
 * - Download action
 */

import React from 'react';
import { FileText, FileCode, FileImage, FileVideo, FileAudio, File, Download, ExternalLink, Eye } from 'lucide-react';
import { ParsedAsset } from './AssetRenderer';

interface FileCardProps {
    asset: ParsedAsset;
    onClick?: () => void;
    onAction?: (action: string) => void;
}

const FILE_ICONS: Record<string, React.ReactNode> = {
    pdf: <FileText className="text-red-400" />,
    doc: <FileText className="text-blue-400" />,
    docx: <FileText className="text-blue-400" />,
    txt: <FileText className="text-slate-400" />,
    md: <FileCode className="text-purple-400" />,
    js: <FileCode className="text-yellow-400" />,
    ts: <FileCode className="text-blue-400" />,
    jsx: <FileCode className="text-cyan-400" />,
    tsx: <FileCode className="text-cyan-400" />,
    py: <FileCode className="text-green-400" />,
    json: <FileCode className="text-orange-400" />,
    html: <FileCode className="text-orange-400" />,
    css: <FileCode className="text-blue-400" />,
    jpg: <FileImage className="text-pink-400" />,
    png: <FileImage className="text-pink-400" />,
    mp4: <FileVideo className="text-purple-400" />,
    mp3: <FileAudio className="text-green-400" />,
};

function getFileExtension(url: string): string {
    const match = url.match(/\.(\w+)(\?|$)/);
    return match ? match[1].toLowerCase() : '';
}

function getFileName(url: string): string {
    const parts = url.split('/');
    const filename = parts[parts.length - 1];
    return filename.split('?')[0] || 'file';
}

function formatFileSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FileCard: React.FC<FileCardProps> = ({
    asset,
    onClick,
    onAction
}) => {
    const ext = getFileExtension(asset.url);
    const fileName = asset.alt || getFileName(asset.url);
    const icon = FILE_ICONS[ext] || <File className="text-slate-400" />;

    const handleDownload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const response = await fetch(asset.url);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Download failed:', err);
        }
    };

    const handleOpenExternal = (e: React.MouseEvent) => {
        e.stopPropagation();
        window.open(asset.url, '_blank');
    };

    return (
        <div
            className="group flex items-center gap-3 p-3 rounded-lg bg-slate-900/60 border border-slate-700/50 cursor-pointer transition-all duration-300 hover:border-cyan-500/50 hover:bg-slate-800/60"
            onClick={onClick}
        >
            {/* Icon */}
            <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-slate-800 [&>svg]:w-5 [&>svg]:h-5">
                {icon}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="text-sm text-white font-medium truncate">
                    {fileName}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="uppercase">{ext}</span>
                    {asset.metadata?.size && (
                        <>
                            <span>•</span>
                            <span>{formatFileSize(asset.metadata.size)}</span>
                        </>
                    )}
                    {asset.provider && (
                        <>
                            <span>•</span>
                            <span className="text-cyan-500">{asset.provider}</span>
                        </>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={(e) => { e.stopPropagation(); onClick?.(); }}
                    className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                    title="Preview"
                >
                    <Eye size={16} className="text-slate-400" />
                </button>
                <button
                    onClick={handleDownload}
                    className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                    title="Download"
                >
                    <Download size={16} className="text-slate-400" />
                </button>
                <button
                    onClick={handleOpenExternal}
                    className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                    title="Open in new tab"
                >
                    <ExternalLink size={16} className="text-slate-400" />
                </button>
            </div>
        </div>
    );
};

export default FileCard;
