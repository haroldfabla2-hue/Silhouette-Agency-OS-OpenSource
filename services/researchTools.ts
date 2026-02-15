/**
 * RESEARCH TOOLS SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Web search, academic search, and citation tools for research agents.
 * Uses Tavily for web search and Semantic Scholar for academic papers.
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    source: string;
    publishedDate?: string;
}

export interface AcademicPaper {
    title: string;
    authors: string[];
    abstract: string;
    year: number;
    citationCount: number;
    url: string;
    paperId: string;
    venue?: string;
}

export interface Citation {
    text: string;
    format: 'APA' | 'MLA' | 'Chicago' | 'BibTeX';
}

// ═══════════════════════════════════════════════════════════════
// WEB SEARCH (Google Custom Search API - Primary, Tavily - Fallback)
// ═══════════════════════════════════════════════════════════════

export async function webSearch(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    // Try Google first (100 free searches/day)
    const googleApiKey = process.env.GOOGLE_API_KEY;
    const googleCxId = process.env.GOOGLE_CX_ID;

    if (googleApiKey && googleCxId) {
        try {
            const results = await googleSearch(query, maxResults, googleApiKey, googleCxId);
            if (results.length > 0) return results;
        } catch (error) {
            console.warn('[RESEARCH] Google Search failed, trying Tavily fallback...');
        }
    }

    // Fallback to Tavily
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey) {
        try {
            const results = await tavilySearch(query, maxResults, tavilyKey);
            if (results.length > 0) return results;
        } catch (error) {
            console.warn('[RESEARCH] Tavily failed, trying DuckDuckGo fallback...');
        }
    }

    // Final fallback: DuckDuckGo (limited but always free)
    return webSearchFallback(query, maxResults);
}

// Google Custom Search API
async function googleSearch(query: string, maxResults: number, apiKey: string, cxId: string): Promise<SearchResult[]> {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cxId);
    url.searchParams.set('q', query);
    url.searchParams.set('num', Math.min(maxResults, 10).toString()); // Google max is 10

    const response = await fetch(url.toString());

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Google Search API error: ${response.status} - ${errorData.error?.message || 'Unknown'}`);
    }

    const data = await response.json();

    console.log(`[RESEARCH] 🔍 Google found ${data.items?.length || 0} results for: "${query.substring(0, 50)}..."`);

    return (data.items || []).map((item: any) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet || '',
        source: new URL(item.link).hostname,
        publishedDate: item.pagemap?.metatags?.[0]?.['article:published_time']
    }));
}

// Tavily Search API
async function tavilySearch(query: string, maxResults: number, apiKey: string): Promise<SearchResult[]> {
    const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key: apiKey,
            query,
            search_depth: 'advanced',
            max_results: maxResults,
            include_answer: false,
            include_raw_content: false
        })
    });

    if (!response.ok) {
        throw new Error(`Tavily API error: ${response.status}`);
    }

    const data = await response.json();

    console.log(`[RESEARCH] 🔍 Tavily found ${data.results?.length || 0} results for: "${query.substring(0, 50)}..."`);

    return (data.results || []).map((r: any) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
        source: new URL(r.url).hostname,
        publishedDate: r.published_date
    }));
}

// Fallback using DuckDuckGo Instant Answer API (limited but free)
async function webSearchFallback(query: string, maxResults: number): Promise<SearchResult[]> {
    try {
        const response = await fetch(
            `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
        );
        const data = await response.json();

        const results: SearchResult[] = [];

        if (data.AbstractText) {
            results.push({
                title: data.Heading || query,
                url: data.AbstractURL || '',
                snippet: data.AbstractText,
                source: data.AbstractSource || 'DuckDuckGo'
            });
        }

        (data.RelatedTopics || []).slice(0, maxResults - 1).forEach((topic: any) => {
            if (topic.Text && topic.FirstURL) {
                results.push({
                    title: topic.Text.split(' - ')[0] || topic.Text,
                    url: topic.FirstURL,
                    snippet: topic.Text,
                    source: 'DuckDuckGo'
                });
            }
        });

        console.log(`[RESEARCH] 🦆 Fallback found ${results.length} results`);
        return results;

    } catch (error) {
        console.error('[RESEARCH] Fallback search failed:', error);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════
// ACADEMIC SEARCH (Semantic Scholar API - Free)
// ═══════════════════════════════════════════════════════════════

export async function academicSearch(query: string, maxResults: number = 5, retryCount: number = 0): Promise<AcademicPaper[]> {
    const MAX_RETRIES = 3;

    try {
        const response = await fetch(
            `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${maxResults}&fields=title,authors,abstract,year,citationCount,url,venue`,
            {
                headers: {
                    'Accept': 'application/json'
                }
            }
        );

        // Handle rate limiting with retry
        if (response.status === 429 && retryCount < MAX_RETRIES) {
            const waitTime = Math.pow(2, retryCount + 1) * 1000; // 2s, 4s, 8s
            console.warn(`[RESEARCH] 📚 Rate limited, waiting ${waitTime / 1000}s before retry ${retryCount + 1}/${MAX_RETRIES}...`);
            await new Promise(r => setTimeout(r, waitTime));
            return academicSearch(query, maxResults, retryCount + 1);
        }

        if (!response.ok) {
            throw new Error(`Semantic Scholar API error: ${response.status}`);
        }

        const data = await response.json();

        console.log(`[RESEARCH] 📚 Found ${data.data?.length || 0} academic papers for: "${query.substring(0, 50)}..."`);

        return (data.data || []).map((paper: any) => ({
            title: paper.title,
            authors: (paper.authors || []).map((a: any) => a.name),
            abstract: paper.abstract || 'No abstract available',
            year: paper.year,
            citationCount: paper.citationCount || 0,
            url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
            paperId: paper.paperId,
            venue: paper.venue
        }));

    } catch (error) {
        console.error('[RESEARCH] Academic search failed:', error);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════
// CITATION GENERATOR
// ═══════════════════════════════════════════════════════════════

export function generateCitation(paper: AcademicPaper, format: Citation['format'] = 'APA'): Citation {
    const authors = paper.authors.length > 0 ? paper.authors : ['Unknown Author'];
    const year = paper.year || 'n.d.';

    let text = '';

    switch (format) {
        case 'APA':
            const firstAuthor = authors[0].split(' ');
            const lastName = firstAuthor[firstAuthor.length - 1];
            const initials = firstAuthor.slice(0, -1).map(n => n[0] + '.').join(' ');
            const authorStr = authors.length > 2
                ? `${lastName}, ${initials}, et al.`
                : authors.length === 2
                    ? `${lastName}, ${initials}, & ${authors[1]}`
                    : `${lastName}, ${initials}`;
            text = `${authorStr} (${year}). ${paper.title}. ${paper.venue || 'Retrieved from'} ${paper.url}`;
            break;

        case 'MLA':
            text = `${authors.join(', ')}. "${paper.title}." ${paper.venue || 'Web'}, ${year}.`;
            break;

        case 'BibTeX':
            const bibtexKey = `${authors[0].split(' ').pop()?.toLowerCase() || 'unknown'}${year}`;
            text = `@article{${bibtexKey},\n  title={${paper.title}},\n  author={${authors.join(' and ')}},\n  year={${year}},\n  journal={${paper.venue || 'Unknown'}}\n}`;
            break;

        default:
            text = `${authors.join(', ')}. "${paper.title}." ${year}.`;
    }

    return { text, format };
}

// ═══════════════════════════════════════════════════════════════
// COMBINED RESEARCH FUNCTION
// ═══════════════════════════════════════════════════════════════

export interface ResearchResults {
    webResults: SearchResult[];
    academicPapers: AcademicPaper[];
    citations: Citation[];
}

export async function conductResearch(
    query: string,
    options: { web?: boolean; academic?: boolean; maxResults?: number } = {}
): Promise<ResearchResults> {
    const { web = true, academic = true, maxResults = 5 } = options;

    console.log(`[RESEARCH] 🔬 Conducting research on: "${query}"`);

    const [webResults, academicPapers] = await Promise.all([
        web ? webSearch(query, maxResults) : Promise.resolve([]),
        academic ? academicSearch(query, maxResults) : Promise.resolve([])
    ]);

    const citations = academicPapers.map(p => generateCitation(p, 'APA'));

    console.log(`[RESEARCH] ✅ Research complete: ${webResults.length} web + ${academicPapers.length} academic`);

    return { webResults, academicPapers, citations };
}

export const researchTools = {
    webSearch,
    academicSearch,
    generateCitation,
    conductResearch
};
