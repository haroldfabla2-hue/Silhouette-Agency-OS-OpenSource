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
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWriteFile } from './utils/atomicWrite';

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
        MAX_RESEARCH_ATTEMPTS: 2,                    // Max retries per gap
        MAX_CONCURRENT_RESEARCH: 3                   // Process up to 3 gaps per cycle
    };

    private readonly GAPS_FILE = path.resolve(process.cwd(), 'data', 'curiosity_gaps.json');

    private knowledgeGaps: KnowledgeGap[] = [];
    private topicFrequency: Map<string, TopicFrequency> = new Map();
    private explorationInterval: NodeJS.Timeout | null = null;
    private lastResearchTime: number = 0;
    private isExploring: boolean = false;
    private readonly loaded: Promise<void>;
    private persistence: Promise<void> = Promise.resolve();
    private events: Promise<void> = Promise.resolve();
    private storageState: 'loading' | 'ready' | 'ready-legacy' | 'blocked' = 'loading';
    private storageError: string | null = null;
    private legacyOriginal: string | null = null;


    constructor() {
        this.loaded = this.loadGaps();
        // Keep failure observable to every awaited entry point without an unhandled rejection.
        void this.loaded.catch(e => logger.warn('Snapshot unavailable; mutations blocked:', e));
        // Listen for topic mentions
        systemBus.subscribe(SystemProtocol.MEMORY_CREATED, (payload: any) => {
            this.queueTopicEvent(() => this.trackTopicFromMemory(payload.payload));
        });

        systemBus.subscribe(SystemProtocol.THOUGHT_EMISSION, (payload: any) => {
            this.queueTopicEvent(() => this.trackTopicFromThought(payload.payload));
        });

        // Mutating entry points await this.loaded before editing restored state.

        logger.info('Initialized. Curiosity is the engine of discovery.');
    }

    private queueTopicEvent(update: () => Promise<void>): void {
        this.events = this.events.catch(() => {}).then(update);
        void this.events.catch(e => logger.warn('Topic persistence failed:', e));
    }

    /** Wait for initial restore and all events received before this call. */
    public async waitForPersistence(): Promise<void> {
        await this.loaded;
        if (this.storageState === 'blocked') throw new Error('Curiosity storage blocked; original retained, recovery required');
        await this.events;
        await this.persistence;
    }

    private async loadGaps(): Promise<void> {
        try {
            const data = await fs.readFile(this.GAPS_FILE, 'utf-8');
            const saved = JSON.parse(data);
            if (!saved || !Array.isArray(saved.gaps) || (saved.topics !== undefined && (!saved.topics || typeof saved.topics !== 'object' || Array.isArray(saved.topics)))) {
                throw new Error('Invalid curiosity snapshot; refusing to overwrite');
            }
            if (!saved.gaps.every((g: any) => g && typeof g.topic === 'string'
                && typeof g.question === 'string' && Number.isFinite(g.priority)
                && Number.isFinite(g.detectedAt) && Number.isFinite(g.attempts)
                && ['PENDING', 'RESEARCHING', 'RESOLVED', 'FAILED'].includes(g.status))
                || !Object.values(saved.topics ?? {}).every((t: any) => t && typeof t.topic === 'string'
                    && Number.isFinite(t.count) && Number.isFinite(t.lastAccessed) && typeof t.hasDepth === 'boolean')) {
                throw new Error('Invalid curiosity record; refusing to overwrite');
            }
            // The historic writer allowed gaps-only snapshots. Absence of
            // topic counters is not corruption and must not discard questions.
            if (saved.topics === undefined) { this.legacyOriginal = data; this.storageState = 'ready-legacy'; }
            else this.storageState = 'ready';
            this.knowledgeGaps = saved.gaps;
            // A prior process cannot still own an in-flight research attempt.
            for (const gap of this.knowledgeGaps) {
                if (gap.status === 'RESEARCHING') gap.status = 'PENDING';
            }
            if (saved.topics) {
                for (const [k, v] of Object.entries(saved.topics)) {
                    this.topicFrequency.set(k, v as TopicFrequency);
                }
            }
            logger.info(`Restored ${this.knowledgeGaps.length} gaps and ${this.topicFrequency.size} topics from disk.`);
        } catch (e: any) {
            if (e.code !== 'ENOENT') {
                this.storageState = 'blocked'; this.storageError = String(e.message || e); throw e;
            }
            this.storageState = 'ready';
        }
    }

    private async saveGaps(): Promise<void> {
        const data = JSON.stringify({ gaps: this.knowledgeGaps,
            topics: Object.fromEntries(this.topicFrequency), savedAt: Date.now() }, null, 2);
        const write = this.persistence.catch(() => {}).then(async () => {
            await fs.mkdir(path.dirname(this.GAPS_FILE), { recursive: true });
            // Preserve exact legacy bytes before the first approved local
            // mutation upgrades its shape. Restoration itself is read-only.
            if (this.legacyOriginal !== null) {
                const backup = `${this.GAPS_FILE}.legacy-${crypto.createHash('sha256').update(this.legacyOriginal).digest('hex')}.json`;
                try { await fs.writeFile(backup, this.legacyOriginal, {flag:'wx',mode:0o600}); }
                catch (error: any) { if (error.code !== 'EEXIST') throw error; }
                if (await fs.readFile(backup,'utf8') !== this.legacyOriginal) throw new Error('Legacy snapshot backup verification failed');
            }
            await atomicWriteFile(this.GAPS_FILE, data);
            this.legacyOriginal = null; this.storageState = 'ready'; this.storageError = null;
        });
        this.persistence = write.catch(error => {
            this.storageState = 'blocked'; this.storageError = String(error.message || error); throw error;
        });
        return this.persistence;
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
            void this.runExplorationCycle().catch(e => logger.warn('Exploration persistence failed:', e));
        }, this.CONFIG.GAP_DETECTION_INTERVAL_MS);

        // Initial run after 2 minutes
        setTimeout(() => { void this.runExplorationCycle().catch(e => logger.warn('Exploration persistence failed:', e)); }, 2 * 60 * 1000);
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
        await this.loaded;
        if (this.storageState === 'blocked') throw new Error('Curiosity storage blocked; original retained, recovery required');
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
            await this.saveGaps();
        }
    }

    /**
     * Track topic mentions from memory events
     */
    private async trackTopicFromMemory(payload: any) {
        await this.loaded;
        if (this.storageState === 'blocked') throw new Error('Curiosity storage blocked; original retained, recovery required');
        if (!payload?.content) return;
        this.extractAndTrackTopics(payload.content);
        await this.saveGaps();
    }

    /**
     * Track topic mentions from thought events
     */
    private async trackTopicFromThought(payload: any) {
        await this.loaded;
        if (this.storageState === 'blocked') throw new Error('Curiosity storage blocked; original retained, recovery required');
        if (!payload?.thoughts) return;
        for (const thought of payload.thoughts) {
            this.extractAndTrackTopics(thought);
        }
        await this.saveGaps();
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
     * Calculate information entropy for a topic (diversity of contexts).
     * High entropy = we hear about this in many different contexts, meaning we should investigate how it all connects.
     */
    private async calculateEntropy(topic: string): Promise<number> {
        try {
            const { graph } = await import('./graphService');
            if (!graph.isConnectedStatus()) return 0.5;

            // Get text content of all nodes mentioning this topic
            const query = `
                MATCH (n)
                WHERE toLower(n.content) CONTAINS $topic 
                   OR toLower(n.label) CONTAINS $topic
                RETURN n.content as text
                LIMIT 20
            `;
            const results = await graph.runQuery(query, { topic: topic.toLowerCase() });

            if (!results || results.length === 0) return 1.0; // Completely unknown
            if (results.length < 2) return 0.5; // Only 1 context = low variance

            const uniqueWords = new Set<string>();
            let validContexts = 0;

            for (const r of results) {
                if (r.text) {
                    const words = String(r.text).toLowerCase().split(/\W+/).filter(w => w.length > 2);
                    words.forEach(w => uniqueWords.add(w));
                    validContexts++;
                }
            }

            if (validContexts === 0) return 1.0;

            // More unique words across different contexts = higher entropy
            const entropy = uniqueWords.size / (validContexts * 10);
            return Math.min(1.0, Math.max(0.1, entropy));
        } catch {
            return 0.5;
        }
    }

    /**
     * Detect knowledge gaps based on topic frequency, depth, and entropy
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
                const entropy = await this.calculateEntropy(topic);

                // Priority combines frequency and entropy calculation from Silhouette-brain
                const discoveryPotential = (freq.count / 10.0) + entropy;

                const gap: KnowledgeGap = {
                    topic,
                    question: await this.generateResearchQuestion(topic),
                    priority: discoveryPotential,
                    detectedAt: Date.now(),
                    status: 'PENDING',
                    attempts: 0
                };

                this.knowledgeGaps.push(gap);
                newGaps.push(gap);

                logger.info(`New Epistemic Gap: "${topic}" (Entropy: ${entropy.toFixed(2)}) → "${gap.question}"`);
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
        await this.saveGaps();

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
        } finally {
            await this.saveGaps();
        }
    }

    /**
     * Store a discovery in memory and graph
     */
    private async storeDiscovery(topic: string, question: string, answer: string) {
        if (!answer.trim()) throw new Error('Empty discovery cannot resolve a knowledge gap');
        const { continuum } = await import('./continuumMemory');
        const { MemoryTier } = await import('../types');
        const content = `[CURIOSITY DISCOVERY] Topic: ${topic}\nQ: ${question}\nA: ${answer}`;
        const receiptTag = `curiosity-discovery:${crypto.createHash('sha256').update(content).digest('hex')}`;
        await continuum.store(content, MemoryTier.MEDIUM,
            ['DISCOVERY', 'CURIOSITY', topic.toUpperCase(), receiptTag]);
        // store() may reject/dedupe without throwing. A resolved gap requires
        // actual canonical readback with this attempt's receipt, not a void return.
        const readback = await continuum.getLatestObservation(receiptTag);
        if (!readback || readback.content !== content) throw new Error('Discovery persistence unverified');

        const { graph } = await import('./graphService');
        if (graph.isConnectedStatus()) {
            await graph.createNode('Discovery', {
                id: receiptTag, topic, question, answer: answer.substring(0, 500),
                source: 'CURIOSITY_SERVICE', timestamp: Date.now()
            }, 'id');
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
        storage: {state: string; mutationsAllowed: boolean; recoveryRequired: boolean; error: string | null};
    } {
        return {
            isExploring: this.isExploring,
            pendingGaps: this.knowledgeGaps.filter(g => g.status === 'PENDING').length,
            resolvedGaps: this.knowledgeGaps.filter(g => g.status === 'RESOLVED').length,
            trackedTopics: this.topicFrequency.size,
            storage: {state:this.storageState, mutationsAllowed:this.storageState === 'ready' || this.storageState === 'ready-legacy',
                recoveryRequired:this.storageState === 'blocked', error:this.storageError}
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
    public async addGap(topic: string, question: string, priority: number = 0.5): Promise<void> {
        await this.loaded;
        if (this.storageState === 'blocked') throw new Error('Curiosity storage blocked; original retained, recovery required');
        const gap: KnowledgeGap = {
            topic,
            question,
            priority,
            detectedAt: Date.now(),
            status: 'PENDING',
            attempts: 0
        };

        this.knowledgeGaps.push(gap);
        await this.saveGaps();
        logger.info(`Manual gap added: "${question}"`);
    }

    /**
     * Trigger immediate research (for testing)
     */
    public async triggerResearch() {
        await this.loaded;
        if (this.storageState === 'blocked') throw new Error('Curiosity storage blocked; original retained, recovery required');
        const pendingGaps = this.knowledgeGaps
            .filter(g => g.status === 'PENDING')
            .sort((a, b) => b.priority - a.priority)
            .slice(0, this.CONFIG.MAX_CONCURRENT_RESEARCH);

        if (pendingGaps.length > 0) {
            logger.info(`Researching ${pendingGaps.length} gaps in parallel...`);
            await Promise.allSettled(
                pendingGaps.map(gap => this.researchGap(gap))
            );
            // Persist after batch research
            await this.saveGaps();
        } else {
            logger.info('No pending gaps to research');
        }
    }
}

export const curiosity = new CuriosityService();
