import { z } from 'zod';
import { MemoryTier } from '../types';

export const MemoryNodeSchema = z.object({
    id: z.string().uuid().or(z.string().min(1)), // Support legacy IDs if needed, but prefer UUID
    content: z.string().min(1, "Memory content cannot be empty"), // 🚨 THE CRITICAL FIX
    originalContent: z.string().optional(),
    timestamp: z.number(),
    tier: z.nativeEnum(MemoryTier),
    importance: z.number().min(0).max(1),
    tags: z.array(z.string()),
    ownerId: z.string().optional(),
    accessCount: z.number().default(0),
    lastAccess: z.number(),
    decayHealth: z.number().optional(),
    compressionLevel: z.number().optional(),
    embeddingVector: z.union([z.instanceof(Float32Array), z.null()]).optional(),
    // Hierarchy Fields
    nestingLevel: z.number().optional(),
    stabilityScore: z.number().optional(),
    raptorLevel: z.number().optional(),
    timeGrid: z.object({
        year: z.number(),
        month: z.number(),
        day: z.number(),
        hour: z.number(),
        weekday: z.number()
    }).optional()
});

export type ValidatedMemoryNode = z.infer<typeof MemoryNodeSchema>;
