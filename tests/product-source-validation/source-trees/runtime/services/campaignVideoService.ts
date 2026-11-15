/**
 * CAMPAIGN VIDEO SERVICE (REMOTION INTEGRATION)
 * ═══════════════════════════════════════════════════════════════
 * Orchestrates programmatic compilation of promotional marketing videos
 * using Remotion CLI and campaign metadata assets.
 */

import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

interface VideoGenerationOptions {
    title: string;
    slogan: string;
    accentColor?: string;
    imageUrls: string[];
    voiceOverUrl?: string;
}

class CampaignVideoService {
    /**
     * Compiles a high-quality campaign promo video
     * @param campaignId Unique ID of the campaign
     * @param options Video assets and text data
     * @returns Promise resolving to the output mp4 file path
     */
    async compileCampaignVideo(
        campaignId: string,
        options: VideoGenerationOptions
    ): Promise<string> {
        console.log(`[VIDEO] 🎬 Initializing video compile for campaign: "${options.title}"`);

        const tempPropsPath = path.join(process.cwd(), `temp_video_props_${campaignId}.json`);
        const outputDir = path.join(process.cwd(), 'output', 'videos');
        
        // Ensure outputs directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const outputVideoPath = path.join(outputDir, `campaign_${campaignId}.mp4`);

        // Format properties for Remotion composition inputs
        const videoProps = {
            titleText: options.title.toUpperCase(),
            sloganText: options.slogan,
            primaryColor: options.accentColor || "#39FF14", // Default Lime Green
            images: options.imageUrls,
            audioSrc: options.voiceOverUrl || ""
        };

        fs.writeFileSync(tempPropsPath, JSON.stringify(videoProps, null, 2), 'utf-8');

        // Target composition defined in user's video layout template
        const compositionId = "FlowPilotPromo"; 
        const entryPoint = path.join(process.cwd(), 'scripts', 'render', 'index.tsx');

        // Check if the render entry point exists, if not we create a basic schema fallback
        this.ensureRenderTemplateExists(entryPoint);

        const cmd = `npx remotion render ${compositionId} "${entryPoint}" "${outputVideoPath}" --props="${tempPropsPath}"`;
        console.log(`[VIDEO] Running command: ${cmd}`);

        return new Promise<string>((resolve, reject) => {
            exec(cmd, (error, stdout, stderr) => {
                // Cleanup temp JSON props
                try {
                    fs.unlinkSync(tempPropsPath);
                } catch (e) {
                    console.error('[VIDEO] Failed to clean up temp video props:', e);
                }

                if (error) {
                    console.error(`[VIDEO] Remotion compile failed: ${stderr || error.message}`);
                    reject(new Error(`Remotion compilation failed: ${stderr || error.message}`));
                    return;
                }

                console.log(`[VIDEO] 📹 Campaign video generated: ${outputVideoPath}`);
                resolve(outputVideoPath);
            });
        });
    }

    /**
     * Helper to write a basic boilerplate Remotion entry point 
     * if the user runs in standalone mode.
     */
    private ensureRenderTemplateExists(entryPath: string) {
        const renderDir = path.dirname(entryPath);
        if (!fs.existsSync(renderDir)) {
            fs.mkdirSync(renderDir, { recursive: true });
        }

        if (!fs.existsSync(entryPath)) {
            const boilerplate = `
import { registerRoot, Composition } from 'remotion';
import React from 'react';

// Basic slide showcase component
const MainScene = (props: any) => {
    const { titleText, sloganText, primaryColor, images } = props;
    return (
        <div style={{
            flex: 1,
            backgroundColor: '#0A0A0A',
            color: '#FFFFFF',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            fontFamily: 'system-ui',
            padding: 40
        }}>
            <h1 style={{ color: primaryColor, fontSize: 80, margin: 0 }}>{titleText}</h1>
            <p style={{ fontSize: 40, opacity: 0.8, marginTop: 20 }}>{sloganText}</p>
            {images && images.length > 0 && (
                <div style={{ display: 'flex', gap: 20, marginTop: 40 }}>
                    {images.map((img: string, i: number) => (
                        <img key={i} src={img} style={{ width: 300, height: 200, objectFit: 'cover', borderRadius: 10 }} />
                    ))}
                </div>
            )}
        </div>
    );
};

registerRoot(() => (
    <>
        <Composition
            id="FlowPilotPromo"
            component={MainScene}
            durationInFrames={150}
            fps={30}
            width={1920}
            height={1080}
            defaultProps={{
                titleText: "SILHOUETTE OS",
                sloganText: "Autonomous Creative Agents Platform",
                primaryColor: "#39FF14",
                images: []
            }}
        />
    </>
));
`;
            fs.writeFileSync(entryPath, boilerplate.trim(), 'utf-8');
            console.log(`[VIDEO] ✍️ Created boilerplate Remotion entry at ${entryPath}`);
        }
    }
}

export const campaignVideoService = new CampaignVideoService();
