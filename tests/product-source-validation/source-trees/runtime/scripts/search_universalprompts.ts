import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Simple text search in universalprompts directory
 * Works without ripgrep or other external tools
 */

interface SearchResult {
    file: string;
    line: number;
    content: string;
    context: string[];
}

async function searchInDirectory(dir: string, pattern: RegExp, maxResults: number = 20): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    async function searchRecursive(currentDir: string) {
        if (results.length >= maxResults) return;

        try {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                if (results.length >= maxResults) break;

                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    await searchRecursive(fullPath);
                } else if (entry.isFile() && (entry.name.endsWith('.txt') || entry.name.endsWith('.md'))) {
                    try {
                        const content = await fs.readFile(fullPath, 'utf-8');
                        const lines = content.split('\n');

                        lines.forEach((line, index) => {
                            if (results.length >= maxResults) return;

                            if (pattern.test(line)) {
                                const contextBefore = lines.slice(Math.max(0, index - 2), index);
                                const contextAfter = lines.slice(index + 1, Math.min(lines.length, index + 6));

                                results.push({
                                    file: path.relative(dir, fullPath),
                                    line: index + 1,
                                    content: line.trim(),
                                    context: [...contextBefore, line, ...contextAfter].map(l => l.trim())
                                });
                            }
                        });
                    } catch (err) {
                        // Skip files that can't be read
                    }
                }
            }
        } catch (err) {
            console.error(`Error reading directory ${currentDir}:`, err);
        }
    }

    await searchRecursive(dir);
    return results;
}

async function main() {
    const universalPromptsDir = path.join(process.cwd(), 'universalprompts');

    console.log('🔍 Searching UniversalPrompts...\n');
    console.log(`Directory: ${universalPromptsDir}\n`);

    const searches = [
        { name: 'Multi-Agent Patterns', pattern: /multi[-\s]agent/i },
        { name: 'OpenAI/GPT Patterns', pattern: /openai|gpt-4|chatgpt/i },
        { name: 'Hierarchy Patterns', pattern: /hierarchy|hierarchical|tier/i },
        { name: 'Communication Protocols', pattern: /communication protocol|message passing/i },
        { name: 'Team/Squad Patterns', pattern: /team structure|squad|coordination/i },
    ];

    const allFindings: any = {};

    for (const search of searches) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📊 ${search.name}`);
        console.log('='.repeat(60));

        const results = await searchInDirectory(universalPromptsDir, search.pattern, 10);

        console.log(`Found ${results.length} matches\n`);

        results.forEach((result, index) => {
            console.log(`${index + 1}. ${result.file}:${result.line}`);
            console.log(`   "${result.content.substring(0, 100)}${result.content.length > 100 ? '...' : ''}"`);
            console.log();
        });

        allFindings[search.name] = results;
    }

    // Save results
    const outputPath = path.join(process.cwd(), 'analysis', 'search_results.json');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(allFindings, null, 2), 'utf-8');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Results saved to: ${outputPath}`);
    console.log(`📊 Total patterns searched: ${searches.length}`);
    console.log(`📚 Total matches found: ${Object.values(allFindings).reduce((sum: number, r: any) => sum + r.length, 0)}`);
}

main().catch(console.error);
