    /**
     * Manually prune idle agents to free up memory.
     * @param force - If true, ignores timeouts and hibernates all IDLE agents.
     */
    public pruneAgents(force: boolean = false): number {
    if (!this.smartPagingEnabled && !force) return 0;

    let prunedCount = 0;
    const now = Date.now();

    this.activeActors.forEach(agent => {
        if (agent.status === AgentStatus.IDLE) {
            const idleTime = now - agent.lastActive;
            let timeout = 300000; // Default 5m

            // Mode Adjustments
            if (this.currentMode === SystemMode.ECO) timeout = 60000; // 1m in Eco
            if (this.currentMode === SystemMode.HIGH) timeout = 1800000; // 30m in High
            if (this.currentMode === SystemMode.ULTRA && !force) return; // Never dehydrate in Ultra unless forced

            // Tier Adjustments
            if (agent.tier === AgentTier.CORE && this.currentMode !== SystemMode.ECO && !force) return; // Core stays unless ECO or forced
            if (agent.tier === AgentTier.WORKER) timeout = timeout / 2; // Workers die faster

            if (force || idleTime > timeout) {
                this.dehydrateAgent(agent.id);
                prunedCount++;
            }
        }
    });

    if (prunedCount > 0) {
        console.log(`[ORCHESTRATOR] 🧹 Pruned ${prunedCount} idle agents.`);
    }
    return prunedCount;
}
