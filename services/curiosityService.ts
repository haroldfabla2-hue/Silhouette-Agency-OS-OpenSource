/**
 * CURIOSITY SERVICE - Proactive Knowledge Exploration
 * 
 * Implements autonomous curiosity-driven learning:
 * 1. Detects knowledge gaps on frequently accessed topics
 * 2. Generates research questions during idle time
 * 3. Uses web search to fill knowledge gaps
 * 4. Integrates discoveries into the knowledge graph
 * 
 * Based on: Intrinsic Motivation, Information Seeking Behavior
 */

import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';

interface KnowledgeGap {
    topic: string;
    question: string;
    priority: number;
    detectedAt: number;
    status: 'PENDING' | 'RESEARCHING' | 'RESOLVED' | 'FAILED';
    attempts: number;
}

interface TopicFrequency {
    topic: string;
    count: number;
    lastAccessed: number;
    hasDepth: boolean; // True if we have detailed knowledge
}

const logger = {
    info: (msg: string, data?: any) => console.log(`[CURIOSITY] 💭 ${msg}`, data || ''),
    warn: (msg: string, data?: any) => console.warn(`[CURIOSITY] ⚠️ ${msg}`, data || ''),
    debug: (msg: string, data?: any) => {
        if (process.env.DEBUG_CURIOSITY) console.log(`[CURIOSITY] 🔍 ${msg}`, data || '');
    }
};

class CuriosityService {
    private readonly CONFIG = {
        GAP_DETECTION_INTERVAL_MS: 15 * 60 * 1000,  // Check every 15 minutes
        MIN_TOPIC_COUNT_FOR_GAP: 3,                  // Topic must be mentioned 3+ times
        MAX_PENDING_GAPS: 10,                        // Don't queue too many questions
        RESEARCH_COOLDOWN_MS: 5 * 60 * 1000,         // Wait 5 min between researches
        MAX_RESEARCH_ATTEMPTS: 2                     // Max retries per gap
    };

    private knowledgeGaps: KnowledgeGap[] = [];
    private topicFrequency: Map<string, TopicFrequency> = new Map();
    private explorationInterval: NodeJS.Timeout | null = null;
    private lastResearchTime: number = 0;
    private isExploring: boolean = false;

    constructor() {
        // Listen for topic mentions
        systemBus.subscribe(SystemProtocol.MEMORY_CREATED, (payload: any) => {
            this.trackTopicFromMemory(payload);
        });

        systemBus.subscribe(SystemProtocol.THOUGHT_EMISSION, (payload: any) => {
            this.trackTopicFromThought(payload);
        });

        logger.info('Initialized. Curiosity is the engine of discovery.');
    }

    /**
     * Start the exploration loop (runs during idle time)
     */
    public startExploration() {
        if (this.explorationInterval) return;

        // [OPTIMIZATION] Check PowerManager before starting
        import('./powerManager').then(({ powerManager }) => {
            if (!powerManager.isCuriosityEnabled) {
                logger.info('Disabled by PowerManager (BALANCED mode). Use startExploration() manually when needed.');
                return;
            }
            this.activateExploration();
        });
    }

    private activateExploration() {
        if (this.explorationInterval) return;
        logger.info('Starting Exploration Loop (Every 15 min)');
        this.explorationInterval = setInterval(() => {
            this.runExplorationCycle();
        }, this.CONFIG.GAP_DETECTION_INTERVAL_MS);

        // Initial run after 2 minutes
        setTimeout(() => this.runExplorationCycle(), 2 * 60 * 1000);
    }

    /**
     * Stop the exploration loop
     */
    public stopExploration() {
        if (this.explorationInterval) {
            clearInterval(this.explorationInterval);
            this.explorationInterval = null;
            logger.info('Exploration Loop stopped');
        }
    }

    /**
     * Main exploration cycle
     */
    private async runExplorationCycle() {
        if (this.isExploring) return;
        this.isExploring = true;

        try {
            // 1. Detect new knowledge gaps
            const newGaps = await this.detectKnowledgeGaps();
            logger.info(`Detected ${newGaps.length} new knowledge gaps`);

            // 2. Process pending gaps (research during idle)
            const pendingGaps = this.knowledgeGaps.filter(g => g.status === 'PENDING');

            if (pendingGaps.length > 0 && this.canResearch()) {
                const topGap = pendingGaps.sort((a, b) => b.priority - a.priority)[0];
                await this.researchGap(topGap);
            }

        } catch (e) {
            logger.warn('Exploration cycle error:', e);
        } finally {
            this.isExploring = false;
        }
    }

    /**
     * Track topic mentions from memory events
     */
    private trackTopicFromMemory(payload: any) {
        if (!payload?.content) return;
        this.extractAndTrackTopics(payload.content);
    }

    /**
     * Track topic mentions from thought events
     */
    private trackTopicFromThought(payload: any) {
        if (!payload?.thoughts) return;
        for (const thought of payload.thoughts) {
            this.extractAndTrackTopics(thought);
        }
    }

    /**
     * Extract and track topics from text
     */
    private extractAndTrackTopics(text: string) {
        // Simple topic extraction: capitalize nouns and technical terms
        const words = text.split(/\s+/);
        const potentialTopics = words.filter(w =>
            w.length > 4 &&
            /^[A-Z]/.test(w) && // Starts with capital
            !/^(The|This|That|When|Where|What|How|Why|Then|Here|There)$/.test(w)
        );

        for (const topic of potentialTopics) {
            const normalized = topic.replace(/[.,!?;:]/g, '').toLowerCase();
            const existing = this.topicFrequency.get(normalized);

            if (existing) {
                existing.count++;
                existing.lastAccessed = Date.now();
            } else {
                this.topicFrequency.set(normalized, {
                    topic: normalized,
                    count: 1,
                    lastAccessed: Date.now(),
                    hasDepth: false
                });
            }
        }
    }

    /**
     * Detect knowledge gaps based on topic frequency vs depth
     */
    private async detectKnowledgeGaps(): Promise<KnowledgeGap[]> {
        const newGaps: KnowledgeGap[] = [];

        // Find frequently mentioned topics without depth
        for (const [topic, freq] of this.topicFrequency) {
            if (freq.count < this.CONFIG.MIN_TOPIC_COUNT_FOR_GAP) continue;
            if (freq.hasDepth) continue;

            // Check if we already have a gap for this topic
            const existingGap = this.knowledgeGaps.find(g =>
                g.topic === topic && g.status !== 'RESOLVED'
            );
            if (existingGap) continue;

            // Check if we have deep knowledge in memory/graph
            const hasDepth = await this.checkTopicDepth(topic);
            freq.hasDepth = hasDepth;

            if (!hasDepth && this.knowledgeGaps.length < this.CONFIG.MAX_PENDING_GAPS) {
                const gap: KnowledgeGap = {
                    topic,
                    question: await this.generateResearchQuestion(topic),
                    priority: freq.count / 10, // Higher frequency = higher priority
                    detectedAt: Date.now(),
                    status: 'PENDING',
                    attempts: 0
                };

                this.knowledgeGaps.push(gap);
                newGaps.push(gap);

                logger.info(`New Gap: "${topic}" → "${gap.question}"`);
            }
        }

        return newGaps;
    }

    /**
     * Check if we have deep knowledge about a topic
     */
    private async checkTopicDepth(topic: string): Promise<boolean> {
        try {
            const { graph } = await import('./graphService');

            if (!graph.isConnectedStatus()) return false;

            // Check if topic has 3+ connections in the graph
            const query = `
                MATCH (n)-[r]-(m)
                WHERE toLower(n.content) CONTAINS $topic 
                   OR toLower(n.label) CONTAINS $topic
                RETURN count(r) as connections
            `;

            const result = await graph.runQuery(query, { topic: topic.toLowerCase() });
            const connections = result[0]?.connections || 0;

            return connections >= 3;
        } catch {
            return false;
        }
    }

    /**
     * Generate a research question for a topic
     */
    private async generateResearchQuestion(topic: string): Promise<string> {
        try {
            const { llmGateway } = await import('./llmGateway');

            const result = await llmGateway.complete(
                `Generate a single, specific research question to deepen understanding of "${topic}". 
                 The question should be answerable via web search.
                 Output ONLY the question, nothing else.`,
                {
                    temperature: 0.7,
                    systemPrompt: 'You are a curious researcher. Be specific and practical.'
                }
            );

            return result.text.trim().replace(/^["']|["']$/g, '');
        } catch {
            // Fallback to simple question
            return `What are the key concepts and applications of ${topic}?`;
        }
    }

    /**
     * Check if we can research (cooldown)
     */
    private canResearch(): boolean {
        return Date.now() - this.lastResearchTime > this.CONFIG.RESEARCH_COOLDOWN_MS;
    }

    /**
     * Research a knowledge gap using web search
     */
    private async researchGap(gap: KnowledgeGap) {
        gap.status = 'RESEARCHING';
        gap.attempts++;
        this.lastResearchTime = Date.now();

        logger.info(`Researching: "${gap.question}"`);

        try {
            // Use research tools to search web
            const { researchTools } = await import('./researchTools');
            const searchResult = await researchTools.webSearch(gap.question);

            if (searchResult && searchResult.length > 0) {
                // Synthesize the findings
                const { llmGateway } = await import('./llmGateway');

                const synthesis = await llmGateway.complete(
                    `Based on the following search results, provide a concise summary answering: "${gap.question}"
                     
                     Search Results:
                     ${searchResult.slice(0, 3).map((r: any) => `- ${r.title}: ${r.snippet}`).join('\n')}
                     
                     Provide a 2-3 sentence synthesis.`,
                    {
                        temperature: 0.3,
                        systemPrompt: 'Be accurate and concise. Focus on key facts.'
                    }
                );

                // Store the discovery
                await this.storeDiscovery(gap.topic, gap.question, synthesis.text);

                gap.status = 'RESOLVED';
                logger.info(`Gap RESOLVED: "${gap.topic}"`);

                // Mark topic as having depth now
                const freq = this.topicFrequency.get(gap.topic);
                if (freq) freq.hasDepth = true;

                // Emit discovery event
                systemBus.emit(SystemProtocol.UI_REFRESH, {
                    source: 'CURIOSITY_SERVICE',
                    topic: gap.topic,
                    question: gap.question,
                    answer: synthesis.text.substring(0, 200)
                });

            } else {
                throw new Error('No search results');
            }

        } catch (e: any) {
            logger.warn(`Research failed for "${gap.topic}":`, e.message);

            if (gap.attempts >= this.CONFIG.MAX_RESEARCH_ATTEMPTS) {
                gap.status = 'FAILED';
            } else {
                gap.status = 'PENDING'; // Retry later
            }
        }
    }

    /**
     * Store a discovery in memory and graph
     */
    private async storeDiscovery(topic: string, question: string, answer: string) {
        try {
            const { continuum } = await import('./continuumMemory');
            const { MemoryTier } = await import('../types');

            // Store in long-term memory
            await continuum.store(
                `[CURIOSITY DISCOVERY] Topic: ${topic}\nQ: ${question}\nA: ${answer}`,
                MemoryTier.MEDIUM,
                ['DISCOVERY', 'CURIOSITY', topic.toUpperCase()]
            );

            // Store in graph
            const { graph } = await import('./graphService');
            if (graph.isConnectedStatus()) {
                const discoveryId = `curiosity_${Date.now()}`;
                await graph.createNode('Discovery', {
                    id: discoveryId,
                    topic,
                    question,
                    answer: answer.substring(0, 500),
                    source: 'CURIOSITY_SERVICE',
                    timestamp: Date.now()
                }, 'id');
            }

        } catch (e) {
            logger.warn('Failed to store discovery:', e);
        }
    }

    /**
     * Get current exploration status
     */
    public getStatus(): {
        isExploring: boolean;
        pendingGaps: number;
        resolvedGaps: number;
        trackedTopics: number;
    } {
        return {
            isExploring: this.isExploring,
            pendingGaps: this.knowledgeGaps.filter(g => g.status === 'PENDING').length,
            resolvedGaps: this.knowledgeGaps.filter(g => g.status === 'RESOLVED').length,
            trackedTopics: this.topicFrequency.size
        };
    }

    /**
     * Get all knowledge gaps
     */
    public getGaps(): KnowledgeGap[] {
        return [...this.knowledgeGaps];
    }

    /**
     * Manually add a knowledge gap (for user-driven curiosity)
     */
    public addGap(topic: string, question: string, priority: number = 0.5) {
        const gap: KnowledgeGap = {
            topic,
            question,
            priority,
            detectedAt: Date.now(),
            status: 'PENDING',
            attempts: 0
        };

        this.knowledgeGaps.push(gap);
        logger.info(`Manual gap added: "${question}"`);
    }

    /**
     * Trigger immediate research (for testing)
     */
    public async triggerResearch() {
        const pendingGaps = this.knowledgeGaps.filter(g => g.status === 'PENDING');
        if (pendingGaps.length > 0) {
            await this.researchGap(pendingGaps[0]);
        } else {
            logger.info('No pending gaps to research');
        }
    }
}

export const curiosity = new CuriosityService();
