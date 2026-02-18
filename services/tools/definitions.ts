
import { FunctionDeclaration, Type } from "@google/genai";

// --- INTERFACES ---

export interface GenerateVideoArgs {
    prompt: string;
    engine?: 'WAN' | 'SVD' | 'ANIMATEDIFF' | 'VID2VID';
    input_asset_path?: string;
    duration?: number;
}

export interface GenerateImageArgs {
    prompt: string;
    style: 'PHOTOREALISTIC' | 'ILLUSTRATION' | 'ICON' | 'VECTOR' | 'STOCK_PHOTO';
    aspectRatio?: '1:1' | '16:9' | '9:16';
    negativePrompt?: string;
    count?: number;
}

export interface ListVisualAssetsArgs {
    filter_type?: 'video' | 'image' | 'all';
    limit?: number;
}

export interface DelegateTaskArgs {
    target_role: string;
    task: string;
    context?: string;
}

// --- JSON SCHEMAS (Gemini Compatible) ---

export const GENERATE_VIDEO_TOOL: FunctionDeclaration = {
    name: "generate_video",
    description: "Generates a video from a text prompt or transforms an existing video/image. Use 'WAN' for text-to-video, 'SVD' for image-to-video, 'VID2VID' for video transformation.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            prompt: {
                type: Type.STRING,
                description: "The text description of the video to generate. Be descriptive."
            },
            engine: {
                type: Type.STRING,
                description: "The generation engine to use. Defaults to 'WAN'.",
                enum: ["WAN", "SVD", "ANIMATEDIFF", "VID2VID"]
            },
            input_asset_path: {
                type: Type.STRING,
                description: "Absolute path to a source image or video file. Required for SVD and VID2VID."
            },
            duration: {
                type: Type.NUMBER,
                description: "Target duration in seconds (approximate). Default is 5."
            }
        },
        required: ["prompt"]
    }
};

export const LIST_VISUAL_ASSETS_TOOL: FunctionDeclaration = {
    name: "list_visual_assets",
    description: "Lists recently generated visual assets (images/videos) available in the system output directory.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            filter_type: {
                type: Type.STRING,
                description: "Filter by asset type.",
                enum: ["video", "image", "all"]
            },
            limit: {
                type: Type.NUMBER,
                description: "Number of most recent assets to return. Default is 10."
            }
        }
    }
};

export const GENERATE_IMAGE_TOOL: FunctionDeclaration = {
    name: "generate_image",
    description: "Generates an image from a text prompt. Use this for all image generation requests.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            prompt: {
                type: Type.STRING,
                description: "The detailed description of the image to generate."
            },
            style: {
                type: Type.STRING,
                description: "The visual style.",
                enum: ["PHOTOREALISTIC", "ILLUSTRATION", "ICON", "VECTOR", "STOCK_PHOTO"]
            },
            aspectRatio: {
                type: Type.STRING,
                description: "Aspect ratio. Default is 16:9.",
                enum: ["1:1", "16:9", "9:16"]
            }
        },
        required: ["prompt", "style"]
    }
};


export const DELEGATE_TASK_TOOL: FunctionDeclaration = {
    name: "delegate_task",
    description: "Delegates a specific sub-task to a specialized agent role. Use this when you need information, research, or verification that is outside your immediate context.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            target_role: {
                type: Type.STRING,
                description: "The role of the agent to delegate to (e.g., 'RESEARCHER', 'QA_ENGINEER', 'DEV_LEAD')."
            },
            task: {
                type: Type.STRING,
                description: "The specific task instructions for the delegate."
            },
            context: {
                type: Type.STRING,
                description: "Optional context or background information needed for the task."
            }
        },
        required: ["target_role", "task"]
    }
};

// ==================== ASSET MANAGEMENT TOOLS ====================

export interface SearchAssetsArgs {
    query?: string;
    type?: 'image' | 'video' | 'audio' | 'document';
    tags?: string[];
    folder?: string;
    limit?: number;
}

export interface ManageAssetArgs {
    action: 'rename' | 'tag' | 'untag' | 'move' | 'delete' | 'favorite' | 'archive';
    asset_id: string;
    new_name?: string;
    tags?: string[];
    folder?: string;
}

export const SEARCH_ASSETS_TOOL: FunctionDeclaration = {
    name: "search_assets",
    description: "Search and list generated assets (images, videos, documents). Use this to find assets by name, type, or tags.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: {
                type: Type.STRING,
                description: "Text to search in asset names, descriptions, and prompts."
            },
            type: {
                type: Type.STRING,
                description: "Filter by asset type.",
                enum: ["image", "video", "audio", "document"]
            },
            tags: {
                type: Type.ARRAY,
                description: "Filter by tags.",
                items: { type: Type.STRING }
            },
            folder: {
                type: Type.STRING,
                description: "Filter by folder path."
            },
            limit: {
                type: Type.NUMBER,
                description: "Maximum number of results. Default 20."
            }
        }
    }
};

export const MANAGE_ASSET_TOOL: FunctionDeclaration = {
    name: "manage_asset",
    description: "Perform actions on an asset: rename, add/remove tags, move to folder, mark as favorite, archive, or delete.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            action: {
                type: Type.STRING,
                description: "The action to perform.",
                enum: ["rename", "tag", "untag", "move", "delete", "favorite", "archive"]
            },
            asset_id: {
                type: Type.STRING,
                description: "The ID of the asset to manage."
            },
            new_name: {
                type: Type.STRING,
                description: "New name for the asset (for 'rename' action)."
            },
            tags: {
                type: Type.ARRAY,
                description: "Tags to add or remove (for 'tag' and 'untag' actions).",
                items: { type: Type.STRING }
            },
            folder: {
                type: Type.STRING,
                description: "Target folder path (for 'move' action)."
            }
        },
        required: ["action", "asset_id"]
    }
};

// PREVIEW ASSET - Show asset in UI popup
export interface PreviewAssetArgs {
    asset_id: string;
    edit_mode?: boolean;
}

export const PREVIEW_ASSET_TOOL: FunctionDeclaration = {
    name: "preview_asset",
    description: "Show an asset preview popup to the user. Use this when the user asks to see, view, or preview a specific asset.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            asset_id: {
                type: Type.STRING,
                description: "The ID of the asset to preview."
            },
            edit_mode: {
                type: Type.BOOLEAN,
                description: "Whether to open in edit mode (for code/text files)."
            }
        },
        required: ["asset_id"]
    }
};

// ==================== RESEARCH TOOLS ====================

export interface WebSearchArgs {
    query: string;
    max_results?: number;
}

export interface AcademicSearchArgs {
    query: string;
    max_results?: number;
}

export interface ConductResearchArgs {
    query: string;
    include_web?: boolean;
    include_academic?: boolean;
    max_results?: number;
}

export const WEB_SEARCH_TOOL: FunctionDeclaration = {
    name: "web_search",
    description: "Search the web for current information on any topic. Use this to find news, articles, documentation, and general web content.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: {
                type: Type.STRING,
                description: "The search query. Be specific for better results."
            },
            max_results: {
                type: Type.NUMBER,
                description: "Maximum number of results to return. Default is 5."
            }
        },
        required: ["query"]
    }
};

export const ACADEMIC_SEARCH_TOOL: FunctionDeclaration = {
    name: "academic_search",
    description: "Search academic papers and research publications on Semantic Scholar. Use this for scientific research, peer-reviewed papers, and academic citations.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: {
                type: Type.STRING,
                description: "The research topic or paper search query."
            },
            max_results: {
                type: Type.NUMBER,
                description: "Maximum number of papers to return. Default is 5."
            }
        },
        required: ["query"]
    }
};

export const CONDUCT_RESEARCH_TOOL: FunctionDeclaration = {
    name: "conduct_research",
    description: "Conduct comprehensive research on a topic using both web and academic sources. Returns combined results with citations. Use this for thorough investigation of hypotheses.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: {
                type: Type.STRING,
                description: "The research query or hypothesis to investigate."
            },
            include_web: {
                type: Type.BOOLEAN,
                description: "Whether to include web search results. Default true."
            },
            include_academic: {
                type: Type.BOOLEAN,
                description: "Whether to include academic papers. Default true."
            },
            max_results: {
                type: Type.NUMBER,
                description: "Maximum results per source. Default is 5."
            }
        },
        required: ["query"]
    }
};

// ==================== SYNTHESIS TOOLS ====================

export const SYNTHESIZE_DISCOVERIES_TOOL: FunctionDeclaration = {
    name: "synthesize_discoveries",
    description: "Synthesize recent discoveries into a coherent insight. Identifies patterns across discoveries, formulates novel hypotheses, and gathers supporting evidence. Use when you have accumulated enough discoveries (default 3+) to create higher-level insights.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            min_discoveries: {
                type: Type.NUMBER,
                description: "Minimum number of accepted discoveries required. Default is 3."
            },
            include_research: {
                type: Type.BOOLEAN,
                description: "Whether to gather supporting evidence via web/academic search. Default true."
            },
            domain: {
                type: Type.STRING,
                description: "Optional domain filter (e.g., 'biology', 'technology', 'philosophy')."
            }
        },
        required: []
    }
};

export const GENERATE_PAPER_TOOL: FunctionDeclaration = {
    name: "generate_paper",
    description: "Generate a professional academic paper from a synthesized insight. Creates structured sections (Introduction, Background, Methodology, Findings, Discussion, Conclusion) with proper citations and peer review.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            insight_id: {
                type: Type.STRING,
                description: "ID of the insight to generate paper from. If not provided, uses the most recent high-confidence insight."
            },
            format: {
                type: Type.STRING,
                description: "Output format: 'markdown', 'latex', or 'json'. Default is 'markdown'."
            },
            authors: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of author names. Default is ['Silhouette AI Research']."
            },
            peer_review: {
                type: Type.BOOLEAN,
                description: "Whether to run automated peer review. Default true."
            }
        },
        required: []
    }
};

// ==================== RIGOROUS PAPER TOOLS ====================

export const COLLECT_REFERENCES_TOOL: FunctionDeclaration = {
    name: "collect_references",
    description: "Collect academic references from Semantic Scholar for a research insight. Builds a bibliography with verified papers.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            insight_id: {
                type: Type.STRING,
                description: "ID of the insight to collect references for."
            },
            min_references: {
                type: Type.NUMBER,
                description: "Minimum number of references to collect. Default is 20."
            },
            min_citations: {
                type: Type.NUMBER,
                description: "Minimum citation count for included papers. Default is 5."
            }
        },
        required: []
    }
};

export const GENERATE_FIGURES_TOOL: FunctionDeclaration = {
    name: "generate_figures",
    description: "Generate academic figures for a research paper, including concept diagrams, charts, and relationship graphs.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            insight_id: {
                type: Type.STRING,
                description: "ID of the insight to generate figures for."
            },
            include_concept_diagram: {
                type: Type.BOOLEAN,
                description: "Whether to generate AI conceptual diagram. Default true."
            },
            include_charts: {
                type: Type.BOOLEAN,
                description: "Whether to generate data charts. Default true."
            }
        },
        required: []
    }
};

export const GENERATE_RIGOROUS_PAPER_TOOL: FunctionDeclaration = {
    name: "generate_rigorous_paper",
    description: "Generate a publication-quality academic paper with full rigor: 20+ verified references, figures, methodology, defined metrics, and peer review.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            insight_id: {
                type: Type.STRING,
                description: "ID of the insight to generate paper from."
            },
            min_references: {
                type: Type.NUMBER,
                description: "Minimum references. Default 20."
            },
            generate_figures: {
                type: Type.BOOLEAN,
                description: "Generate concept diagrams and charts. Default true."
            },
            format: {
                type: Type.STRING,
                description: "Output format: 'markdown', 'latex', or 'json'."
            },
            max_revisions: {
                type: Type.NUMBER,
                description: "Maximum revision iterations based on peer review. Default 2."
            }
        },
        required: []
    }
};

// ==================== GITHUB TOOLS ====================

export interface GitHubCreatePRArgs {
    title: string;
    body: string;
    branch_name: string;
    files: Array<{
        path: string; // Relative path
        content: string; // Text content
        message?: string; // Commit message for this file
    }>;
}

export interface GitHubListPRsArgs {
    state?: 'open' | 'closed' | 'all';
    limit?: number;
}

export interface GitHubCheckPRArgs {
    pr_number: number;
}

export const GITHUB_CREATE_PR_TOOL: FunctionDeclaration = {
    name: "github_create_pr",
    description: "Create a new Pull Request with code changes. Use this to propose code modifications, fix bugs, or add features. Automatically handles branch creation and file updates.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            title: {
                type: Type.STRING,
                description: "Title of the Pull Request."
            },
            body: {
                type: Type.STRING,
                description: "Description of the changes and rationale."
            },
            branch_name: {
                type: Type.STRING,
                description: "Name of the new branch (e.g., 'fix/login-bug', 'feat/new-tool')."
            },
            files: {
                type: Type.ARRAY,
                description: "List of files to create or modify.",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        path: { type: Type.STRING, description: "Relative file path" },
                        content: { type: Type.STRING, description: "New file content" },
                        message: { type: Type.STRING, description: "Commit message for this file" }
                    },
                    required: ["path", "content"]
                }
            }
        },
        required: ["title", "body", "branch_name", "files"]
    }
};

export const GITHUB_LIST_PRS_TOOL: FunctionDeclaration = {
    name: "github_list_prs",
    description: "List active Pull Requests. Use to check status of ongoing changes or reviews.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            state: {
                type: Type.STRING,
                enum: ["open", "closed", "all"],
                description: "Filter by PR state. Default 'open'."
            },
            limit: {
                type: Type.NUMBER,
                description: "Max results. Default 10."
            }
        }
    }
};

export const GITHUB_CHECK_PR_TOOL: FunctionDeclaration = {
    name: "github_check_pr",
    description: "Check the CI/CD status of a Pull Request. Use to see if tests passed.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            pr_number: {
                type: Type.NUMBER,
                description: "The PR number to check."
            }
        },
        required: ["pr_number"]
    }
};

// ==================== META TOOLS (Self-Extension) ====================

export interface CreateToolArgs {
    name: string;
    purpose: string;
    category: 'MEDIA' | 'RESEARCH' | 'ASSET' | 'WORKFLOW' | 'UTILITY';
    implementation?: 'COMPOSE' | 'CODE';
    inputs: Array<{
        name: string;
        type: 'string' | 'number' | 'boolean' | 'array' | 'object';
        description: string;
        required?: boolean;
    }>;
    // For COMPOSE
    compose_from?: Array<{
        tool_name: string;
        input_mapping: Record<string, string>;
        output_as?: string;
    }>;
    // For CODE
    code?: string;
    tags?: string[];
}

export const CREATE_TOOL: FunctionDeclaration = {
    name: "create_tool",
    description: "Create a new tool dynamically. Supports two modes: 1) Composition (chaining existing tools) or 2) Code (providing a TypeScript handler). Use this to extend system capabilities.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            name: {
                type: Type.STRING,
                description: "Tool name in snake_case (e.g., 'generate_campaign', 'batch_upscale')"
            },
            purpose: {
                type: Type.STRING,
                description: "Clear description of what the tool does and when to use it"
            },
            category: {
                type: Type.STRING,
                description: "Tool category for organization",
                enum: ["MEDIA", "RESEARCH", "ASSET", "WORKFLOW", "UTILITY"]
            },
            implementation: {
                type: Type.STRING,
                description: "Implementation type: 'COMPOSE' (chaining) or 'CODE' (TypeScript). Default 'COMPOSE'.",
                enum: ["COMPOSE", "CODE"]
            },
            inputs: {
                type: Type.ARRAY,
                description: "List of input parameters the tool accepts",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING },
                        type: { type: Type.STRING, enum: ['string', 'number', 'boolean', 'array', 'object'] },
                        description: { type: Type.STRING },
                        required: { type: Type.BOOLEAN }
                    },
                    required: ['name', 'type', 'description']
                }
            },
            compose_from: {
                type: Type.ARRAY,
                description: "[COMPOSE ONLY] List of existing tools to compose from.",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        tool_name: { type: Type.STRING },
                        input_mapping: { type: Type.OBJECT },
                        output_as: { type: Type.STRING }
                    },
                    required: ["tool_name", "input_mapping"]
                }
            },
            code: {
                type: Type.STRING,
                description: "[CODE ONLY] The TypeScript code for the handler. Must export an async function matching the handler name."
            },
            tags: {
                type: Type.ARRAY,
                description: "Optional tags for searchability",
                items: { type: Type.STRING }
            }
        },
        required: ["name", "purpose", "category", "inputs"]
    }
};

export const LIST_MY_TOOLS: FunctionDeclaration = {
    name: "list_my_tools",
    description: "List all available tools, optionally filtered by category. Use this to discover what capabilities are available.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            category: {
                type: Type.STRING,
                description: "Filter by category",
                enum: ["MEDIA", "RESEARCH", "ASSET", "WORKFLOW", "UTILITY", "META", "ALL"]
            },
            include_disabled: {
                type: Type.BOOLEAN,
                description: "Include disabled tools. Default false."
            }
        }
    }
};

export const CREATE_SKILL: FunctionDeclaration = {
    name: "create_skill",
    description: "Create a new skill (SKILL.md) for the system. Use this to permanently teach the system a new procedure or best practice. Requires a clear set of instructions.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            name: {
                type: Type.STRING,
                description: "Skill name in snake_case (e.g., 'deploy_to_vercel', 'audit_security')."
            },
            description: {
                type: Type.STRING,
                description: "Brief description of what the skill does."
            },
            instructions: {
                type: Type.STRING,
                description: "Detailed Markdown instructions for the skill. Include steps, examples, and rules."
            },
            metadata: {
                type: Type.OBJECT,
                description: "Optional metadata for the skill.",
                properties: {
                    userInvocable: { type: Type.BOOLEAN },
                    commandDispatch: { type: Type.STRING, enum: ['prompt', 'tool', 'agent'] },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    requires: { type: Type.ARRAY, items: { type: Type.STRING } }
                }
            }
        },
        required: ["name", "description", "instructions"]
    }
};

// ==================== SYSTEM CONTROL TOOLS ====================

export const SYSTEM_EXECUTE_COMMAND_TOOL: FunctionDeclaration = {
    name: "system_execute_command",
    description: "Execute a shell command on the host system. CAUTION: Use with extreme care. This tool gives you direct access to the terminal.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            command: {
                type: Type.STRING,
                description: "The shell command to execute (e.g., 'npm install', 'python script.py')."
            },
            cwd: {
                type: Type.STRING,
                description: "Optional current working directory."
            },
            background: {
                type: Type.BOOLEAN,
                description: "Run in background (fire and forget). Default false."
            }
        },
        required: ["command"]
    }
};

export const SYSTEM_OPEN_APP_TOOL: FunctionDeclaration = {
    name: "system_open_app",
    description: "Launch an application or open a file with the default associated program.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            target: {
                type: Type.STRING,
                description: "Name of the application or path to the file (e.g., 'notepad', 'calc', 'C:/Report.pdf')."
            }
        },
        required: ["target"]
    }
};

export const SYSTEM_GET_SCREENSHOT_TOOL: FunctionDeclaration = {
    name: "system_get_screenshot",
    description: "Capture a screenshot of the entire desktop visible area.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            monitor_index: {
                type: Type.NUMBER,
                description: "Index of monitor to capture (default 0)."
            }
        }
    }
};

export const SYSTEM_GET_INFO_TOOL: FunctionDeclaration = {
    name: "system_get_info",
    description: "Get detailed system information including OS, CPU, Memory, and Process statistics. Use this to understand the environment constraints.",
    parameters: {
        type: Type.OBJECT,
        properties: {}
    }
};

export const ARCHITECT_AUDIT_TOOL: FunctionDeclaration = {
    name: "architect_audit",
    description: "Perform a self-audit of the system architecture, documentation sync, and structural alignment. Use this to verify the health of the Agency OS code and documentation.",
    parameters: {
        type: Type.OBJECT,
        properties: {}
    }
};

export const AGENT_TOOLS = [
    GENERATE_VIDEO_TOOL,
    GENERATE_IMAGE_TOOL,
    LIST_VISUAL_ASSETS_TOOL,
    DELEGATE_TASK_TOOL,
    SEARCH_ASSETS_TOOL,
    MANAGE_ASSET_TOOL,
    PREVIEW_ASSET_TOOL,
    // Research Tools
    WEB_SEARCH_TOOL,
    ACADEMIC_SEARCH_TOOL,
    CONDUCT_RESEARCH_TOOL,
    // Synthesis Tools
    SYNTHESIZE_DISCOVERIES_TOOL,
    GENERATE_PAPER_TOOL,
    // Rigorous Paper Tools
    COLLECT_REFERENCES_TOOL,
    GENERATE_FIGURES_TOOL,
    GENERATE_RIGOROUS_PAPER_TOOL,
    // Meta Tools (Self-Extension)
    CREATE_TOOL,
    CREATE_SKILL,
    LIST_MY_TOOLS,
    // GitHub Tools (Engineered Flow)
    GITHUB_CREATE_PR_TOOL,
    GITHUB_LIST_PRS_TOOL,
    GITHUB_CHECK_PR_TOOL,
    // System Control Tools (Exposed to Agent)
    SYSTEM_EXECUTE_COMMAND_TOOL,
    SYSTEM_OPEN_APP_TOOL,
    SYSTEM_GET_SCREENSHOT_TOOL,
    SYSTEM_GET_INFO_TOOL,
    // Architectural Self-Awareness
    ARCHITECT_AUDIT_TOOL
];

// ==================== PRODUCTION VIDEO TOOLS ====================

export interface StartVideoProductionArgs {
    brief: string;
    target_minutes: number;
    platform?: 'youtube' | 'reels' | 'tiktok' | 'cinema' | 'ad' | 'documentary';
}

export interface GetProductionStatusArgs {
    project_id: string;
}

export const START_VIDEO_PRODUCTION_TOOL: FunctionDeclaration = {
    name: "start_video_production",
    description: "Start a full video production pipeline. This creates a storyboard, generates consistent characters, produces all clips with transitions, and composes a final long-form video. Use for videos longer than 30 seconds.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            brief: {
                type: Type.STRING,
                description: "Creative brief describing the video content. Be detailed about the story, message, and style."
            },
            target_minutes: {
                type: Type.NUMBER,
                description: "Target duration in minutes (0.5 to 120). Example: 5 for a 5-minute video."
            },
            platform: {
                type: Type.STRING,
                description: "Target platform affects aspect ratio and pacing.",
                enum: ["youtube", "reels", "tiktok", "cinema", "ad", "documentary"]
            }
        },
        required: ["brief", "target_minutes"]
    }
};

export const GET_PRODUCTION_STATUS_TOOL: FunctionDeclaration = {
    name: "get_production_status",
    description: "Get the current status and progress of a video production project.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            project_id: {
                type: Type.STRING,
                description: "The production project ID returned from start_video_production."
            }
        },
        required: ["project_id"]
    }
};

export const LIST_PRODUCTIONS_TOOL: FunctionDeclaration = {
    name: "list_productions",
    description: "List all video production projects with their status.",
    parameters: {
        type: Type.OBJECT,
        properties: {}
    }
};

// Extended AGENT_TOOLS with production capabilities
export const ALL_TOOLS = [
    ...AGENT_TOOLS,
    // Production Video Tools
    START_VIDEO_PRODUCTION_TOOL,
    GET_PRODUCTION_STATUS_TOOL,
    LIST_PRODUCTIONS_TOOL,
    // System Control Tools
    SYSTEM_EXECUTE_COMMAND_TOOL,
    SYSTEM_OPEN_APP_TOOL,
    SYSTEM_GET_SCREENSHOT_TOOL,
    SYSTEM_GET_INFO_TOOL
];


// ==================== FILESYSTEM TOOLS (Antigravity Parity) ====================

export interface ReadFileArgs {
    path: string;
}

export interface WriteFileArgs {
    path: string;
    content: string;
    create_dirs?: boolean;
}

export interface ListFilesArgs {
    directory: string;
    pattern?: string;
    recursive?: boolean;
}

export const READ_FILE_TOOL: FunctionDeclaration = {
    name: "read_file",
    description: "Read the contents of a file from the filesystem. Use this to examine code, documents, or data files.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            path: {
                type: Type.STRING,
                description: "Absolute or relative path to the file to read."
            }
        },
        required: ["path"]
    }
};

export const WRITE_FILE_TOOL: FunctionDeclaration = {
    name: "write_file",
    description: "Write content to a file. Creates the file if it doesn't exist. Use for creating code, documents, or data files.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            path: {
                type: Type.STRING,
                description: "Absolute or relative path to the file to write."
            },
            content: {
                type: Type.STRING,
                description: "The content to write to the file."
            },
            create_dirs: {
                type: Type.BOOLEAN,
                description: "Create parent directories if they don't exist. Default: true."
            }
        },
        required: ["path", "content"]
    }
};

export const LIST_FILES_TOOL: FunctionDeclaration = {
    name: "list_files",
    description: "List files and directories in a given path. Use to explore project structure.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            directory: {
                type: Type.STRING,
                description: "Path to the directory to list."
            },
            pattern: {
                type: Type.STRING,
                description: "Optional glob pattern to filter files (e.g., '*.ts', '*.md')."
            },
            recursive: {
                type: Type.BOOLEAN,
                description: "List files recursively. Default: false."
            }
        },
        required: ["directory"]
    }
};

// ==================== WORKSPACE TOOLS ====================

export interface WorkspaceCreateArgs {
    title: string;
    content: string;
    format?: 'markdown' | 'code' | 'document' | 'presentation';
    tags?: string[];
}

export interface WorkspaceReadArgs {
    documentId: string;
}

export interface WorkspaceUpdateArgs {
    documentId: string;
    content?: string;
    title?: string;
    append?: boolean;
}

export interface WorkspaceSearchArgs {
    query: string;
    limit?: number;
}

export const WORKSPACE_CREATE_TOOL: FunctionDeclaration = {
    name: "workspace_create",
    description: "Create a new document in the Dynamic Workspace. Use for writing reports, plans, presentations, or any structured content.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            title: {
                type: Type.STRING,
                description: "Title of the document."
            },
            content: {
                type: Type.STRING,
                description: "Initial content of the document (Markdown supported)."
            },
            format: {
                type: Type.STRING,
                description: "Document format.",
                enum: ["markdown", "code", "document", "presentation"]
            },
            tags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Tags for organizing the document."
            }
        },
        required: ["title", "content"]
    }
};

export const WORKSPACE_READ_TOOL: FunctionDeclaration = {
    name: "workspace_read",
    description: "Read the contents of a document from the Dynamic Workspace.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            documentId: {
                type: Type.STRING,
                description: "ID of the document to read."
            }
        },
        required: ["documentId"]
    }
};

export const WORKSPACE_UPDATE_TOOL: FunctionDeclaration = {
    name: "workspace_update",
    description: "Update an existing document in the Dynamic Workspace.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            documentId: {
                type: Type.STRING,
                description: "ID of the document to update."
            },
            content: {
                type: Type.STRING,
                description: "New content (replaces existing unless append=true)."
            },
            title: {
                type: Type.STRING,
                description: "New title (optional)."
            },
            append: {
                type: Type.BOOLEAN,
                description: "Append content instead of replacing. Default: false."
            }
        },
        required: ["documentId"]
    }
};

export const WORKSPACE_LIST_TOOL: FunctionDeclaration = {
    name: "workspace_list",
    description: "List all documents in the Dynamic Workspace.",
    parameters: {
        type: Type.OBJECT,
        properties: {}
    }
};

export const WORKSPACE_SEARCH_TOOL: FunctionDeclaration = {
    name: "workspace_search",
    description: "Search for documents in the Dynamic Workspace by content or title.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: {
                type: Type.STRING,
                description: "Search query."
            },
            limit: {
                type: Type.NUMBER,
                description: "Maximum results. Default: 10."
            }
        },
        required: ["query"]
    }
};

// ==================== CODE EXECUTION TOOL ====================

export interface ExecuteCodeArgs {
    language: 'python' | 'javascript' | 'typescript' | 'bash';
    code: string;
    timeout?: number;
    purpose?: string;  // Optional: Describe what the code should do (for security review)
}

export const EXECUTE_CODE_TOOL: FunctionDeclaration = {
    name: "execute_code",
    description: "Execute code in a sandboxed environment. Use for testing, data processing, or automation. Safety limits apply.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            language: {
                type: Type.STRING,
                description: "Programming language.",
                enum: ["python", "javascript", "typescript", "bash"]
            },
            code: {
                type: Type.STRING,
                description: "The code to execute."
            },
            timeout: {
                type: Type.NUMBER,
                description: "Maximum execution time in seconds. Default: 30."
            }
        },
        required: ["language", "code"]
    }
};

// ==================== COMPLETE TOOLS EXPORT ====================

export const DEVELOPMENT_TOOLS = [
    // Filesystem
    READ_FILE_TOOL,
    WRITE_FILE_TOOL,
    LIST_FILES_TOOL,
    // Workspace
    WORKSPACE_CREATE_TOOL,
    WORKSPACE_READ_TOOL,
    WORKSPACE_UPDATE_TOOL,
    WORKSPACE_LIST_TOOL,
    WORKSPACE_SEARCH_TOOL,
    // Code Execution
    EXECUTE_CODE_TOOL
];

// ==================== UI CONTROL TOOLS (Omnipresent Silhouette) ====================

export interface NavigateToArgs {
    destination: 'dashboard' | 'chat' | 'orchestrator' | 'canvas' | 'media' | 'system' |
    'memory' | 'settings' | 'introspection' | 'workspace' | 'training' | 'terminal';
    highlight_element?: string;
    message?: string;
}

export interface UIActionArgs {
    action: 'open_panel' | 'close_panel' | 'click_button' | 'highlight' | 'scroll_to' | 'show_tooltip';
    target?: string;
    panel?: 'drive' | 'email' | 'notifications' | 'settings';
    message?: string;
    duration_ms?: number;
}

export const NAVIGATE_TO_TOOL: FunctionDeclaration = {
    name: "navigate_to",
    description: "Navigate the user to a specific section of the application. Use this to guide users to the right place or when they ask to go somewhere. You can also highlight a specific element.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            destination: {
                type: Type.STRING,
                description: "The section to navigate to.",
                enum: ["dashboard", "chat", "orchestrator", "canvas", "media", "system",
                    "memory", "settings", "introspection", "workspace", "training", "terminal"]
            },
            highlight_element: {
                type: Type.STRING,
                description: "Optional CSS selector or element ID to highlight after navigation."
            },
            message: {
                type: Type.STRING,
                description: "Optional message to show to the user after navigation."
            }
        },
        required: ["destination"]
    }
};

export const UI_ACTION_TOOL: FunctionDeclaration = {
    name: "ui_action",
    description: "Perform actions on the user interface. Open/close panels, highlight elements, show tooltips. Use this to guide users through the interface or demonstrate features.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            action: {
                type: Type.STRING,
                description: "The UI action to perform.",
                enum: ["open_panel", "close_panel", "click_button", "highlight", "scroll_to", "show_tooltip"]
            },
            target: {
                type: Type.STRING,
                description: "CSS selector or element ID to target."
            },
            panel: {
                type: Type.STRING,
                description: "For open_panel/close_panel: which panel.",
                enum: ["drive", "email", "notifications", "settings"]
            },
            message: {
                type: Type.STRING,
                description: "Message to show in tooltip or notification."
            },
            duration_ms: {
                type: Type.NUMBER,
                description: "Duration for highlights/tooltips in milliseconds. Default: 3000."
            }
        },
        required: ["action"]
    }
};

export const UI_CONTROL_TOOLS = [
    NAVIGATE_TO_TOOL,
    UI_ACTION_TOOL
];

// ==================== PRESENTATION TOOLS ====================

export interface CreatePresentationArgs {
    topic: string;
    num_slides?: number;
    theme?: 'modern-dark' | 'corporate' | 'pitch-deck' | 'academic' | 'minimal' | 'creative';
    include_research?: boolean;
    generate_images?: boolean;
    target_audience?: string;
    style?: 'formal' | 'casual' | 'technical';
    language?: string;
}

export const CREATE_PRESENTATION_TOOL: FunctionDeclaration = {
    name: "create_presentation",
    description: "Create a professional presentation with AI-generated slides, research, and visuals. The presentation will be saved to the workspace and can be viewed in the Dynamic Workspace. Use this when the user asks for presentations, slide decks, pitch decks, or similar formats.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            topic: {
                type: Type.STRING,
                description: "Main topic or title for the presentation. Be specific and descriptive."
            },
            num_slides: {
                type: Type.NUMBER,
                description: "Number of slides to generate (5-15 recommended). Default: 7"
            },
            theme: {
                type: Type.STRING,
                description: "Visual theme for the presentation.",
                enum: ["modern-dark", "corporate", "pitch-deck", "academic", "minimal", "creative"]
            },
            include_research: {
                type: Type.BOOLEAN,
                description: "Whether to search the web for current information on the topic. Default: true"
            },
            generate_images: {
                type: Type.BOOLEAN,
                description: "Whether to generate AI images for slides. Default: true"
            },
            target_audience: {
                type: Type.STRING,
                description: "Who the presentation is for (e.g., 'executives', 'students', 'technical team')"
            },
            style: {
                type: Type.STRING,
                description: "Communication style.",
                enum: ["formal", "casual", "technical"]
            },
            language: {
                type: Type.STRING,
                description: "Language for the presentation content. Default: Spanish"
            }
        },
        required: ["topic"]
    }
};

export const PRESENTATION_TOOLS = [
    CREATE_PRESENTATION_TOOL
];

export const COMPLETE_TOOLS = [
    ...ALL_TOOLS,
    ...DEVELOPMENT_TOOLS,
    ...UI_CONTROL_TOOLS
];
// ==================== PLUGIN TOOLS (Phase 14) ====================

export interface CreatePluginArgs {
    name: string;
    id: string;
    category: string;
    description: string;
    tools: string[];
}

export const CREATE_PLUGIN_TOOL: FunctionDeclaration = {
    name: "create_plugin",
    description: "Create a new Plugin with standardized structure. Use this to extend the system with complex functionality (unlike simple skills) that requires TypeScript code. Scaffolds directory, index.ts, and tools.ts.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            name: { type: Type.STRING, description: "Human readable name (e.g., 'Google Calendar')" },
            id: { type: Type.STRING, description: "Kebab-case ID (e.g., 'google-calendar')" },
            category: { type: Type.STRING, description: "Category folder (e.g., 'integrations', 'media')" },
            description: { type: Type.STRING, description: "Description of the plugin's purpose." },
            tools: {
                type: Type.ARRAY,
                description: "List of tool names to scaffold (e.g., ['list_events', 'create_event'])",
                items: { type: Type.STRING }
            }
        },
        required: ["name", "id", "category", "description", "tools"]
    }
};

export interface RequestCollaborationArgs {
    target_role: string;
    message: string;
    context?: string;
    priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
}

export const REQUEST_COLLABORATION_TOOL: FunctionDeclaration = {
    name: "request_collaboration",
    description: "Request collaboration or send a message to another agent. Use this to ask for help, delegate tasks, or share information with agents in different roles.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            target_role: {
                type: Type.STRING,
                description: "The role of the target agent (e.g., 'RESEARCHER', 'DEV_LEAD')."
            },
            message: {
                type: Type.STRING,
                description: "The message or request content."
            },
            context: {
                type: Type.STRING,
                description: "Optional context or data to share."
            },
            priority: {
                type: Type.STRING,
                description: "Priority of the request. Default 'NORMAL'.",
                enum: ["LOW", "NORMAL", "HIGH", "CRITICAL"]
            }
        },
        required: ["target_role", "message"]
    }
};

export const AGENT_TOOLS_EXPANDED = [
    ...AGENT_TOOLS,
    CREATE_PLUGIN_TOOL,
    REQUEST_COLLABORATION_TOOL
];
