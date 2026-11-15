/**
 * Visual Analysis Service
 * 
 * Provides AI-powered image analysis capabilities for the canvas editor.
 * Designed to match Photoshop's AI features while being resource-efficient.
 * 
 * Features:
 * - Select Subject: Auto-detect and mask main subject
 * - Remove Background: Generate alpha mask for background removal
 * - Composition Analysis: Analyze image structure for AI suggestions
 * 
 * Uses Silhouette's geminiService for vision processing with ResourceArbiter throttling.
 */

import { geminiService } from './geminiService';
import { CommunicationLevel } from '../types';

interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    confidence: number;
}

interface CompositionAnalysis {
    dominantColors: string[];
    subjects: string[];
    style: string;
    mood: string;
    suggestedPrompts: string[];
}

interface MaskResult {
    maskBase64: string; // PNG with alpha channel
    confidence: number;
    boundingBox: BoundingBox;
}

class VisualAnalysisService {
    private isProcessing: boolean = false;

    /**
     * Select Subject - Photoshop-style automatic subject selection
     * Uses Gemini Vision to identify the main subject and generate a mask
     */
    async selectSubject(imageBase64: string): Promise<MaskResult | null> {
        if (this.isProcessing) {
            console.warn('[VisualAnalysis] Already processing, skipping');
            return null;
        }

        this.isProcessing = true;

        try {
            console.log('[VisualAnalysis] 🎯 Analyzing image for subject selection...');

            // Use Gemini Vision to analyze the image and get subject bounding box
            const analysisPrompt = `Analyze this image and identify the main subject.
            
Return a JSON object with:
{
  "subject": "description of the main subject",
  "boundingBox": {
    "x": percentage from left (0-100),
    "y": percentage from top (0-100),
    "width": percentage width (0-100),
    "height": percentage height (0-100)
  },
  "confidence": 0-1 confidence score
}

ONLY return the JSON, no other text.`;

            const response = await geminiService.createCompletion(analysisPrompt, {
                communicationLevel: CommunicationLevel.TECHNICAL,
                images: [imageBase64]
            });

            // Parse the response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.warn('[VisualAnalysis] Could not parse subject detection response');
                return null;
            }

            const analysis = JSON.parse(jsonMatch[0]);

            console.log(`[VisualAnalysis] ✅ Subject detected: ${analysis.subject} (${Math.round(analysis.confidence * 100)}% confidence)`);

            // Generate a simple mask placeholder (actual mask generation would require
            // segmentation model - for now we use bounding box)
            return {
                maskBase64: await this.generateBoundingBoxMask(
                    analysis.boundingBox,
                    800, // Assumed width
                    600  // Assumed height
                ),
                confidence: analysis.confidence,
                boundingBox: {
                    x: analysis.boundingBox.x,
                    y: analysis.boundingBox.y,
                    width: analysis.boundingBox.width,
                    height: analysis.boundingBox.height,
                    label: analysis.subject,
                    confidence: analysis.confidence
                }
            };

        } catch (e: any) {
            console.error('[VisualAnalysis] Subject selection failed:', e.message);
            return null;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Remove Background - Generate alpha mask for background removal
     * Uses vision model to identify foreground vs background
     */
    async removeBackground(imageBase64: string): Promise<MaskResult | null> {
        if (this.isProcessing) {
            console.warn('[VisualAnalysis] Already processing, skipping');
            return null;
        }

        this.isProcessing = true;

        try {
            console.log('[VisualAnalysis] 🪄 Analyzing image for background removal...');

            const analysisPrompt = `Analyze this image and identify the foreground subject that should be kept.
            
Return a JSON object with:
{
  "foregroundDescription": "what should be kept",
  "backgroundDescription": "what should be removed",
  "boundingBox": {
    "x": percentage from left (0-100),
    "y": percentage from top (0-100),
    "width": percentage width (0-100),
    "height": percentage height (0-100)
  },
  "complexity": "simple" | "medium" | "complex",
  "confidence": 0-1 confidence score
}

ONLY return the JSON, no other text.`;

            const response = await geminiService.createCompletion(analysisPrompt, {
                communicationLevel: CommunicationLevel.TECHNICAL,
                images: [imageBase64]
            });

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.warn('[VisualAnalysis] Could not parse background detection response');
                return null;
            }

            const analysis = JSON.parse(jsonMatch[0]);

            console.log(`[VisualAnalysis] ✅ Foreground: ${analysis.foregroundDescription} | Complexity: ${analysis.complexity}`);

            return {
                maskBase64: await this.generateBoundingBoxMask(
                    analysis.boundingBox,
                    800,
                    600
                ),
                confidence: analysis.confidence,
                boundingBox: {
                    x: analysis.boundingBox.x,
                    y: analysis.boundingBox.y,
                    width: analysis.boundingBox.width,
                    height: analysis.boundingBox.height,
                    label: analysis.foregroundDescription,
                    confidence: analysis.confidence
                }
            };

        } catch (e: any) {
            console.error('[VisualAnalysis] Background removal failed:', e.message);
            return null;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Analyze Composition - Get AI insights about image structure
     */
    async analyzeComposition(imageBase64: string): Promise<CompositionAnalysis | null> {
        if (this.isProcessing) {
            return null;
        }

        this.isProcessing = true;

        try {
            console.log('[VisualAnalysis] 🎨 Analyzing image composition...');

            const analysisPrompt = `Analyze this image's composition and visual elements.

Return a JSON object with:
{
  "dominantColors": ["#hex1", "#hex2", "#hex3"],
  "subjects": ["list", "of", "identified", "elements"],
  "style": "photographic style description",
  "mood": "emotional mood/atmosphere",
  "suggestedPrompts": ["3 AI prompt suggestions for similar images"]
}

ONLY return the JSON, no other text.`;

            const response = await geminiService.createCompletion(analysisPrompt, {
                communicationLevel: CommunicationLevel.TECHNICAL,
                images: [imageBase64]
            });

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return null;
            }

            const analysis = JSON.parse(jsonMatch[0]);
            console.log(`[VisualAnalysis] ✅ Composition: ${analysis.style}, ${analysis.mood}`);

            return analysis;

        } catch (e: any) {
            console.error('[VisualAnalysis] Composition analysis failed:', e.message);
            return null;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Generate a simple bounding box mask (placeholder for proper segmentation)
     * In production, this would use a proper segmentation model
     */
    private async generateBoundingBoxMask(
        box: { x: number; y: number; width: number; height: number },
        imgWidth: number,
        imgHeight: number
    ): Promise<string> {
        // Create canvas for mask
        const canvas = document.createElement('canvas');
        canvas.width = imgWidth;
        canvas.height = imgHeight;
        const ctx = canvas.getContext('2d')!;

        // Fill with black (masked out)
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, imgWidth, imgHeight);

        // Draw white rectangle where subject is (visible)
        ctx.fillStyle = 'white';
        const x = (box.x / 100) * imgWidth;
        const y = (box.y / 100) * imgHeight;
        const w = (box.width / 100) * imgWidth;
        const h = (box.height / 100) * imgHeight;

        // Add slight feather effect with rounded corners
        ctx.beginPath();
        const radius = Math.min(w, h) * 0.05;
        ctx.roundRect(x, y, w, h, radius);
        ctx.fill();

        return canvas.toDataURL('image/png');
    }
}

export const visualAnalysis = new VisualAnalysisService();
