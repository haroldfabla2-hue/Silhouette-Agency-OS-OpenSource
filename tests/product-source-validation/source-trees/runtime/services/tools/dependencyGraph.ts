/**
 * DEPENDENCY GRAPH - DAG-based Dependency Management
 * 
 * Provides:
 * 1. Cycle detection using DFS
 * 2. Topological sorting for execution order
 * 3. Dependent lookup for deletion protection
 * 4. Version constraint resolution
 * 
 * Part of the Robust Dependency Management System
 */

// ==================== SEMVER UTILITIES ====================

export interface SemVer {
    major: number;
    minor: number;
    patch: number;
    prerelease?: string;
}

/**
 * Parse a semantic version string
 */
export function parseSemVer(version: string): SemVer | null {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    if (!match) return null;

    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
        prerelease: match[4]
    };
}

/**
 * Compare two semantic versions
 * Returns: -1 (a < b), 0 (a == b), 1 (a > b)
 */
export function compareSemVer(a: SemVer, b: SemVer): number {
    if (a.major !== b.major) return a.major > b.major ? 1 : -1;
    if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
    if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;

    // Prerelease versions have lower precedence
    if (a.prerelease && !b.prerelease) return -1;
    if (!a.prerelease && b.prerelease) return 1;
    if (a.prerelease && b.prerelease) {
        return a.prerelease.localeCompare(b.prerelease);
    }

    return 0;
}

/**
 * Check if version satisfies a constraint
 * Supports: exact, ^, ~, >=, >, <=, <, x, *
 */
export function satisfiesConstraint(version: string, constraint: string): boolean {
    const v = parseSemVer(version);
    if (!v) return false;

    // Wildcard
    if (constraint === '*' || constraint === 'x') return true;

    // Exact match
    if (/^\d+\.\d+\.\d+$/.test(constraint)) {
        return version === constraint;
    }

    // Caret (^) - compatible with major version
    if (constraint.startsWith('^')) {
        const c = parseSemVer(constraint.substring(1));
        if (!c) return false;
        if (v.major !== c.major) return false;
        if (v.major === 0) {
            // 0.x.x - minor must match
            if (v.minor !== c.minor) return false;
            return v.patch >= c.patch;
        }
        return compareSemVer(v, c) >= 0;
    }

    // Tilde (~) - compatible with minor version
    if (constraint.startsWith('~')) {
        const c = parseSemVer(constraint.substring(1));
        if (!c) return false;
        return v.major === c.major && v.minor === c.minor && v.patch >= c.patch;
    }

    // Greater than or equal
    if (constraint.startsWith('>=')) {
        const c = parseSemVer(constraint.substring(2));
        if (!c) return false;
        return compareSemVer(v, c) >= 0;
    }

    // Greater than
    if (constraint.startsWith('>') && !constraint.startsWith('>=')) {
        const c = parseSemVer(constraint.substring(1));
        if (!c) return false;
        return compareSemVer(v, c) > 0;
    }

    // Less than or equal
    if (constraint.startsWith('<=')) {
        const c = parseSemVer(constraint.substring(2));
        if (!c) return false;
        return compareSemVer(v, c) <= 0;
    }

    // Less than
    if (constraint.startsWith('<') && !constraint.startsWith('<=')) {
        const c = parseSemVer(constraint.substring(1));
        if (!c) return false;
        return compareSemVer(v, c) < 0;
    }

    // X-range (1.x, 1.2.x)
    if (constraint.includes('x') || constraint.includes('X')) {
        const parts = constraint.split('.');
        if (parts.length >= 1 && parts[0] !== 'x' && parts[0] !== 'X') {
            if (v.major !== parseInt(parts[0], 10)) return false;
        }
        if (parts.length >= 2 && parts[1] !== 'x' && parts[1] !== 'X') {
            if (v.minor !== parseInt(parts[1], 10)) return false;
        }
        return true;
    }

    // Default: exact match fallback
    return version === constraint;
}

// ==================== DEPENDENCY TYPES ====================

export interface ToolDependency {
    toolName: string;
    versionConstraint: string;
    optional: boolean;
}

export interface CycleDetectionResult {
    hasCycle: boolean;
    cyclePath?: string[];
}

export interface DependencyResolution {
    success: boolean;
    executionOrder: string[];
    errors?: string[];
}

// ==================== DEPENDENCY GRAPH ====================

export class DependencyGraph {
    private static instance: DependencyGraph;

    // Adjacency list: tool -> set of tools it depends ON
    private dependsOn: Map<string, Set<string>> = new Map();

    // Reverse index: tool -> set of tools that depend on IT
    private dependedBy: Map<string, Set<string>> = new Map();

    // Version constraints
    private constraints: Map<string, Map<string, string>> = new Map(); // tool -> (depTool -> constraint)

    private constructor() { }

    public static getInstance(): DependencyGraph {
        if (!DependencyGraph.instance) {
            DependencyGraph.instance = new DependencyGraph();
        }
        return DependencyGraph.instance;
    }

    /**
     * Add a dependency edge
     */
    public addDependency(tool: string, dependsOnTool: string, versionConstraint: string = '*'): void {
        // Initialize if needed
        if (!this.dependsOn.has(tool)) {
            this.dependsOn.set(tool, new Set());
        }
        if (!this.dependedBy.has(dependsOnTool)) {
            this.dependedBy.set(dependsOnTool, new Set());
        }
        if (!this.constraints.has(tool)) {
            this.constraints.set(tool, new Map());
        }

        // Add edges
        this.dependsOn.get(tool)!.add(dependsOnTool);
        this.dependedBy.get(dependsOnTool)!.add(tool);
        this.constraints.get(tool)!.set(dependsOnTool, versionConstraint);

        console.log(`[DependencyGraph] 🔗 ${tool} depends on ${dependsOnTool} (${versionConstraint})`);
    }

    /**
     * Remove all dependencies for a tool
     */
    public removeTool(tool: string): void {
        // Remove from dependsOn
        const deps = this.dependsOn.get(tool);
        if (deps) {
            for (const dep of deps) {
                this.dependedBy.get(dep)?.delete(tool);
            }
        }
        this.dependsOn.delete(tool);

        // Remove from dependedBy
        const dependents = this.dependedBy.get(tool);
        if (dependents) {
            for (const dependent of dependents) {
                this.dependsOn.get(dependent)?.delete(tool);
                this.constraints.get(dependent)?.delete(tool);
            }
        }
        this.dependedBy.delete(tool);

        // Remove constraints
        this.constraints.delete(tool);
    }

    /**
     * Detect cycles using DFS
     */
    public detectCycle(startFrom?: string): CycleDetectionResult {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const dfs = (node: string, path: string[]): string[] | null => {
            visited.add(node);
            recursionStack.add(node);
            path.push(node);

            const deps = this.dependsOn.get(node) || new Set();
            for (const neighbor of deps) {
                if (!visited.has(neighbor)) {
                    const cyclePath = dfs(neighbor, [...path]);
                    if (cyclePath) return cyclePath;
                } else if (recursionStack.has(neighbor)) {
                    // Found cycle!
                    return [...path, neighbor];
                }
            }

            recursionStack.delete(node);
            return null;
        };

        // Check from specific node or all nodes
        const nodesToCheck = startFrom
            ? [startFrom]
            : Array.from(this.dependsOn.keys());

        for (const node of nodesToCheck) {
            if (!visited.has(node)) {
                const cyclePath = dfs(node, []);
                if (cyclePath) {
                    // Trim path to just the cycle
                    const cycleStart = cyclePath.lastIndexOf(cyclePath[cyclePath.length - 1]);
                    return {
                        hasCycle: true,
                        cyclePath: cyclePath.slice(cycleStart)
                    };
                }
            }
        }

        return { hasCycle: false };
    }

    /**
     * Check if adding a dependency would create a cycle
     */
    public wouldCreateCycle(tool: string, dependsOnTool: string): boolean {
        // Temporarily add the edge
        this.addDependency(tool, dependsOnTool);

        // Check for cycles starting from the new dependency
        const result = this.detectCycle(tool);

        // Remove the temporary edge
        this.dependsOn.get(tool)?.delete(dependsOnTool);
        this.dependedBy.get(dependsOnTool)?.delete(tool);
        this.constraints.get(tool)?.delete(dependsOnTool);

        return result.hasCycle;
    }

    /**
     * Get topological sort (execution order)
     */
    public getExecutionOrder(tool: string): DependencyResolution {
        const result: string[] = [];
        const visited = new Set<string>();
        const errors: string[] = [];

        const visit = (node: string): void => {
            if (visited.has(node)) return;
            visited.add(node);

            const deps = this.dependsOn.get(node) || new Set();
            for (const dep of deps) {
                visit(dep);
            }

            result.push(node);
        };

        // First check for cycles
        const cycleCheck = this.detectCycle(tool);
        if (cycleCheck.hasCycle) {
            return {
                success: false,
                executionOrder: [],
                errors: [`Circular dependency detected: ${cycleCheck.cyclePath?.join(' → ')}`]
            };
        }

        visit(tool);

        return {
            success: true,
            executionOrder: result
        };
    }

    /**
     * Get all tools that depend on a given tool
     */
    public getDependents(tool: string): string[] {
        return Array.from(this.dependedBy.get(tool) || []);
    }

    /**
     * Get all dependencies of a tool
     */
    public getDependencies(tool: string): ToolDependency[] {
        const deps = this.dependsOn.get(tool) || new Set();
        const constraints = this.constraints.get(tool) || new Map();

        return Array.from(deps).map(dep => ({
            toolName: dep,
            versionConstraint: constraints.get(dep) || '*',
            optional: false
        }));
    }

    /**
     * Check if tool can be safely deleted
     */
    public canDelete(tool: string): { canDelete: boolean; blockedBy?: string[] } {
        const dependents = this.getDependents(tool);
        if (dependents.length > 0) {
            return {
                canDelete: false,
                blockedBy: dependents
            };
        }
        return { canDelete: true };
    }

    /**
     * Get graph snapshot for debugging/visualization
     */
    public getSnapshot(): {
        nodes: string[];
        edges: { from: string; to: string; constraint: string }[];
    } {
        const nodes = new Set<string>();
        const edges: { from: string; to: string; constraint: string }[] = [];

        for (const [tool, deps] of this.dependsOn) {
            nodes.add(tool);
            for (const dep of deps) {
                nodes.add(dep);
                edges.push({
                    from: tool,
                    to: dep,
                    constraint: this.constraints.get(tool)?.get(dep) || '*'
                });
            }
        }

        return {
            nodes: Array.from(nodes),
            edges
        };
    }

    /**
     * Clear all data (for testing)
     */
    public clear(): void {
        this.dependsOn.clear();
        this.dependedBy.clear();
        this.constraints.clear();
    }
}

export const dependencyGraph = DependencyGraph.getInstance();
