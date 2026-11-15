/**
 * Chat Components - Asset Display System
 * 
 * Exports all chat asset components for clean imports
 * Usage: import { AssetRenderer, AssetLightbox } from '@/components/chat';
 */

export { AssetRenderer, parseAssets, getAssetType } from './AssetRenderer';
export type { ParsedAsset } from './AssetRenderer';

export { ImageCard } from './ImageCard';
export { VideoCard } from './VideoCard';
export { AudioCard } from './AudioCard';
export { FileCard } from './FileCard';
export { AssetCarousel } from './AssetCarousel';
export { AssetLightbox } from './AssetLightbox';

// Re-export existing component if present
export { AssetGrid } from './AssetGrid';
