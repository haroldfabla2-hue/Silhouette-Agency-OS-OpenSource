// =============================================================================
// Nexus Canvas - API Client
// Frontend hooks for canvas backend operations
// =============================================================================

const API_BASE = '/v1/media/canvas';

export interface CanvasDocumentMeta {
    id: string;
    name: string;
    width: number;
    height: number;
    layerCount: number;
    thumbnailPath?: string;
    createdAt: number;
    updatedAt: number;
}

/**
 * List all saved canvas documents
 */
export async function listDocuments(): Promise<CanvasDocumentMeta[]> {
    const res = await fetch(`${API_BASE}/documents`);
    if (!res.ok) throw new Error('Failed to list documents');
    const data = await res.json();
    return data.documents || [];
}

/**
 * Load a specific document
 */
export async function loadDocument(id: string): Promise<any> {
    const res = await fetch(`${API_BASE}/documents/${id}`);
    if (!res.ok) throw new Error('Document not found');
    const data = await res.json();
    return data.document;
}

/**
 * Save a document (create or update)
 */
export async function saveDocument(
    name: string,
    documentJson: string,
    thumbnail?: string,
    id?: string
): Promise<CanvasDocumentMeta> {
    const res = await fetch(`${API_BASE}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, documentJson, thumbnail })
    });

    if (!res.ok) throw new Error('Failed to save document');
    const data = await res.json();
    return data.document;
}

/**
 * Delete a document
 */
export async function deleteDocument(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/documents/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete document');
}

/**
 * Generative Fill (AI Inpainting)
 */
export async function inpaint(
    imageBase64: string,
    maskBase64: string,
    prompt: string,
    options?: {
        negativePrompt?: string;
        preferLocal?: boolean;
    }
): Promise<{ imageBase64: string; provider: string }> {
    const res = await fetch(`${API_BASE}/inpaint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            imageBase64,
            maskBase64,
            prompt,
            negativePrompt: options?.negativePrompt,
            preferLocal: options?.preferLocal
        })
    });

    if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Inpaint failed' }));
        throw new Error(error.error || 'Inpaint failed');
    }

    const data = await res.json();
    return {
        imageBase64: data.imageBase64,
        provider: data.provider
    };
}

/**
 * Export canvas to Asset Catalog
 */
export async function exportToAssets(
    imageBase64: string,
    name: string,
    options?: {
        prompt?: string;
        tags?: string[];
        folder?: string;
    }
): Promise<string> {
    const res = await fetch(`${API_BASE}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            imageBase64,
            name,
            prompt: options?.prompt,
            tags: options?.tags,
            folder: options?.folder
        })
    });

    if (!res.ok) throw new Error('Failed to export');
    const data = await res.json();
    return data.assetId;
}
