import { CreativeContext, BrandDigitalTwin, GenesisTemplate } from '../types';
import { vectorMemory } from './vectorMemoryService';

class ContextResolver {

    /**
     * Resolves a CreativeContext from a Brand ID.
     */
    public async resolveFromBrand(brandId: string): Promise<CreativeContext> {
        const brand = await vectorMemory.getBrandTwin(brandId);
        if (!brand) throw new Error(`Brand ${brandId} not found`);

        return {
            identity: { type: 'BRAND', id: brand.id, name: brand.name },
            constraints: {
                colors: brand.designSystem.colorPalette.primary,
                forbidden: brand.manifesto.emotionalSpectrum.forbidden,
                style: brand.manifesto.emotionalSpectrum.primary,
                typography: brand.designSystem.typography.primary
            },
            inspirations: {
                keywords: brand.manifesto.keywords.positive,
                references: [], // Could fetch from vault
                mood: brand.manifesto.toneOfVoice.join(', ')
            },
            history: { successfulPrompts: [] }
        };
    }

    /**
     * Resolves a CreativeContext from a Project Template (Genesis).
     */
    public resolveFromProject(template: GenesisTemplate, projectName: string): CreativeContext {
        // Default styles based on template type
        let style = "Modern, Clean, Professional";
        let colors = ["#000000", "#ffffff", "#3b82f6"]; // Default Blue/Black/White
        let keywords = ["SaaS", "Dashboard", "UI"];

        switch (template) {
            case 'REACT_VITE':
                style = "Minimalist, Glassmorphism, Tech";
                colors = ["#646cff", "#ffffff", "#213547"]; // Vite colors
                break;
            case 'NEXT_JS':
                style = "Corporate, High-Performance, Vercel-style";
                colors = ["#000000", "#ffffff"];
                break;
            case 'FULL_STACK_CRM':
                style = "Enterprise, Data-Dense, Trustworthy";
                colors = ["#0f172a", "#334155", "#e2e8f0"]; // Slate
                keywords = ["CRM", "Data", "Analytics"];
                break;
        }

        return {
            identity: { type: 'PROJECT', id: `proj_${Date.now()}`, name: projectName },
            constraints: {
                colors,
                forbidden: ["Cartoon", "Low Quality", "Distorted"],
                style
            },
            inspirations: {
                keywords,
                references: [],
                mood: "Professional, Efficient"
            },
            history: { successfulPrompts: [] }
        };
    }

    /**
     * Resolves a CreativeContext from a raw user prompt (Ad-Hoc).
     * In a real system, this would use an LLM to infer style.
     */
    public resolveFromPrompt(prompt: string): CreativeContext {
        // Simple heuristic for now
        const isDark = prompt.toLowerCase().includes('dark');
        const isCyber = prompt.toLowerCase().includes('cyber') || prompt.toLowerCase().includes('neon');

        return {
            identity: { type: 'USER', id: 'user_adhoc' },
            constraints: {
                colors: isCyber ? ["#00ff00", "#ff00ff", "#000000"] : (isDark ? ["#1a1a1a", "#ffffff"] : ["#ffffff", "#000000"]),
                forbidden: ["Blurry", "Watermark"],
                style: isCyber ? "Cyberpunk, Neon, Futuristic" : "Photorealistic, High Quality"
            },
            inspirations: {
                keywords: prompt.split(' '),
                references: [],
                mood: "Dynamic"
            },
            history: { successfulPrompts: [] }
        };
    }
}

export const contextResolver = new ContextResolver();
