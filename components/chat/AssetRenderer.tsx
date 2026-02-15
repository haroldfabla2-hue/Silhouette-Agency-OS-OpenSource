/**
 * AssetRenderer - Intelligent Asset Display System
 * 
 * Parses message content for asset references and renders appropriate cards.
 * Supports: Images, Videos, Audio, Files
 * 
 * Detection Methods:
 * 1. Markdown image syntax: ![alt](url)
 * 2. Asset protocol tags: <<<<ASSET:TYPE:url>>>>
 * 3. Raw URLs with media extensions
 * 4. Tool result objects in message metadata
 */

import React, { useMemo } from 'react';
import { ImageCard } from './ImageCard';
import { VideoCard } from './VideoCard';
import { AudioCard } from './AudioCard';
import { FileCard } from './FileCard';
import { AssetCarousel } from './AssetCarousel';

// Asset type definitions
export interface ParsedAsset {
    id: string;
    type: 'image' | 'video' | 'audio' | 'file';
    url: string;
    alt?: string;
    provider?: string;
    prompt?: string;
    metadata?: Record<string, any>;
}

interface AssetRendererProps {
    content: string;
    metadata?: {
        assets?: ParsedAsset[];
        toolResults?: any[];
    };
    onAssetClick?: (asset: ParsedAsset) => void;
    onAction?: (action: string, asset: ParsedAsset) => void;
}

// Regex patterns for asset detection
const PATTERNS = {
    // Markdown images: ![alt](url)
    MARKDOWN_IMAGE: /!\[([^\]]*)\]\(([^)]+)\)/g,

    // Protocol tags: <<<<ASSET:image:https://...>>>>
    ASSET_TAG: /<<<<ASSET:(\w+):([^>]+)>>>>/g,

    // Raw URLs (images)
    IMAGE_URL: /(https?:\/\/[^\s<>"']+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s<>"']*)?)/gi,

    // Raw URLs (videos)
    VIDEO_URL: /(https?:\/\/[^\s<>"']+\.(mp4|webm|mov|avi)(\?[^\s<>"']*)?)/gi,

    // Raw URLs (audio)
    AUDIO_URL: /(https?:\/\/[^\s<>"']+\.(mp3|wav|ogg|m4a)(\?[^\s<>"']*)?)/gi,

    // Local file paths (for ComfyUI output)
    LOCAL_PATH: /(?:file:\/\/|output\/|generated\/)([\w\-./]+\.(jpg|jpeg|png|gif|webp|mp4|webm|mp3|wav))/gi,

    // Tool result markers
    TOOL_RESULT: /\[ASSET_GENERATED\]\s*(\{[^}]+\})/g,
};

// Extension to type mapping
const EXT_TYPE_MAP: Record<string, ParsedAsset['type']> = {
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image',
    mp4: 'video', webm: 'video', mov: 'video', avi: 'video',
    mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio',
    pdf: 'file', doc: 'file', docx: 'file', txt: 'file', md: 'file',
};

function getExtension(url: string): string {
    const match = url.match(/\.(\w+)(\?|$)/);
    return match ? match[1].toLowerCase() : '';
}

function getAssetType(url: string): ParsedAsset['type'] {
    const ext = getExtension(url);
    return EXT_TYPE_MAP[ext] || 'file';
}

function generateId(): string {
    return `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse content string and extract all asset references
 */
function parseAssets(content: string, existingAssets?: ParsedAsset[]): { assets: ParsedAsset[], cleanContent: string } {
    const assets: ParsedAsset[] = existingAssets ? [...existingAssets] : [];
    const seenUrls = new Set(assets.map(a => a.url));
    let cleanContent = content;

    // 1. Parse Markdown images
    let match;
    while ((match = PATTERNS.MARKDOWN_IMAGE.exec(content)) !== null) {
        const [fullMatch, alt, url] = match;
        if (!seenUrls.has(url)) {
            seenUrls.add(url);
            assets.push({
                id: generateId(),
                type: getAssetType(url),
                url,
                alt: alt || undefined,
            });
        }
        cleanContent = cleanContent.replace(fullMatch, ''); // Remove from text
    }

    // 2. Parse Protocol Tags
    PATTERNS.ASSET_TAG.lastIndex = 0;
    while ((match = PATTERNS.ASSET_TAG.exec(content)) !== null) {
        const [fullMatch, type, url] = match;
        if (!seenUrls.has(url)) {
            seenUrls.add(url);
            assets.push({
                id: generateId(),
                type: type.toLowerCase() as ParsedAsset['type'],
                url,
            });
        }
        cleanContent = cleanContent.replace(fullMatch, '');
    }

    // 3. Parse raw image URLs
    PATTERNS.IMAGE_URL.lastIndex = 0;
    while ((match = PATTERNS.IMAGE_URL.exec(content)) !== null) {
        const url = match[1];
        if (!seenUrls.has(url)) {
            seenUrls.add(url);
            assets.push({
                id: generateId(),
                type: 'image',
                url,
            });
        }
        // Don't remove raw URLs from content - they might be in links
    }

    // 4. Parse raw video URLs
    PATTERNS.VIDEO_URL.lastIndex = 0;
    while ((match = PATTERNS.VIDEO_URL.exec(content)) !== null) {
        const url = match[1];
        if (!seenUrls.has(url)) {
            seenUrls.add(url);
            assets.push({
                id: generateId(),
                type: 'video',
                url,
            });
        }
    }

    // 5. Parse raw audio URLs
    PATTERNS.AUDIO_URL.lastIndex = 0;
    while ((match = PATTERNS.AUDIO_URL.exec(content)) !== null) {
        const url = match[1];
        if (!seenUrls.has(url)) {
            seenUrls.add(url);
            assets.push({
                id: generateId(),
                type: 'audio',
                url,
            });
        }
    }

    return { assets, cleanContent: cleanContent.trim() };
}

/**
 * AssetRenderer Component
 * 
 * Renders assets inline within chat messages
 */
export const AssetRenderer: React.FC<AssetRendererProps> = ({
    content,
    metadata,
    onAssetClick,
    onAction
}) => {
    const { assets, cleanContent } = useMemo(() => {
        return parseAssets(content, metadata?.assets);
    }, [content, metadata?.assets]);

    // Group assets by type for organized display
    const groupedAssets = useMemo(() => {
        const groups: Record<ParsedAsset['type'], ParsedAsset[]> = {
            image: [],
            video: [],
            audio: [],
            file: [],
        };
        assets.forEach(asset => {
            groups[asset.type].push(asset);
        });
        return groups;
    }, [assets]);

    const handleAssetClick = (asset: ParsedAsset) => {
        onAssetClick?.(asset);
    };

    const handleAction = (action: string, asset: ParsedAsset) => {
        onAction?.(action, asset);
    };

    // No assets found - return null (parent will render text normally)
    if (assets.length === 0) {
        return null;
    }

    return (
        <div className="asset-renderer space-y-3 my-2">
            {/* Images - Grid or Carousel */}
            {groupedAssets.image.length > 0 && (
                groupedAssets.image.length <= 4 ? (
                    <div className={`grid gap-2 ${groupedAssets.image.length === 1 ? 'grid-cols-1' :
                            groupedAssets.image.length === 2 ? 'grid-cols-2' :
                                'grid-cols-2 md:grid-cols-3'
                        }`}>
                        {groupedAssets.image.map(asset => (
                            <ImageCard
                                key={asset.id}
                                asset={asset}
                                onClick={() => handleAssetClick(asset)}
                                onAction={(action) => handleAction(action, asset)}
                            />
                        ))}
                    </div>
                ) : (
                    <AssetCarousel
                        assets={groupedAssets.image}
                        onAssetClick={handleAssetClick}
                        onAction={handleAction}
                    />
                )
            )}

            {/* Videos - Inline players */}
            {groupedAssets.video.length > 0 && (
                <div className="space-y-2">
                    {groupedAssets.video.map(asset => (
                        <VideoCard
                            key={asset.id}
                            asset={asset}
                            onClick={() => handleAssetClick(asset)}
                            onAction={(action) => handleAction(action, asset)}
                        />
                    ))}
                </div>
            )}

            {/* Audio - Waveform players */}
            {groupedAssets.audio.length > 0 && (
                <div className="space-y-2">
                    {groupedAssets.audio.map(asset => (
                        <AudioCard
                            key={asset.id}
                            asset={asset}
                            onAction={(action) => handleAction(action, asset)}
                        />
                    ))}
                </div>
            )}

            {/* Files - Compact list */}
            {groupedAssets.file.length > 0 && (
                <div className="space-y-1">
                    {groupedAssets.file.map(asset => (
                        <FileCard
                            key={asset.id}
                            asset={asset}
                            onClick={() => handleAssetClick(asset)}
                            onAction={(action) => handleAction(action, asset)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// Export utilities for external use
export { parseAssets, getAssetType };
export default AssetRenderer;
