# Silhouette Agency OS - Capabilities Manifest
**Auto-generated for Silhouette self-awareness**

## 🔧 DEVELOPMENT TOOLS (10)

| Tool | Description | Handler |
|------|-------------|---------|
| `read_file` | Read file contents | Direct fs/promises |
| `write_file` | Write/create files | Direct fs/promises |
| `list_files` | List directory | Direct fs/promises |
| `workspace_create` | Create Workspace doc | canvasService |
| `workspace_read` | Read Workspace doc | canvasService |
| `workspace_update` | Update Workspace doc | canvasService |
| `workspace_list` | List all docs | canvasService |
| `workspace_search` | Search docs | canvasService |
| `execute_code` | Execute JS/TS/Python/Bash | vm + spawn |
| `create_tool` | Create new tools dynamically | toolFactory |

## 🎬 MEDIA TOOLS (5)

| Tool | Description |
|------|-------------|
| `generate_video` | Text-to-video (WAN/SVD) |
| `generate_image` | Text-to-image |
| `list_visual_assets` | List generated assets |
| `start_video_production` | Full video production pipeline |
| `get_production_status` | Check production status |

## 🔍 RESEARCH TOOLS (3)

| Tool | Description |
|------|-------------|
| `web_search` | Search the web |
| `academic_search` | Academic paper search |
| `conduct_research` | Full research workflow |

## 📧 COMMUNICATION (2)

| Tool | Description |
|------|-------------|
| `send_email` | Send Gmail |
| `read_inbox` | Read Gmail inbox |

## 👥 AGENT MANAGEMENT

| Capability | API |
|------------|-----|
| `agentFactory.architectAgent()` | Create agents from blueprint |
| `agentFactory.evolveAgent()` | Improve existing agents |
| `agentFactory.spawnForTask()` | Dynamic agent for task |

## 🔌 INTEGRATIONS

| Integration | Status |
|-------------|--------|
| MCP Server | ✅ `/mcp/sse` - Expose all tools |
| LanceDB | ✅ Semantic memory |
| Gemini API | ✅ Primary LLM |
| GitHub | ✅ PR management |
| Google Drive | ✅ File sync |
| Gmail | ✅ Email |
| ComfyUI | ✅ AI media generation |

## 📊 SELF-IMPROVEMENT CAPABILITIES

- `toolFactory.createFromDescription()` - Create tools from natural language
- `toolFactory.composeTool()` - Chain existing tools
- `toolEvolver` - Improve tool performance
- `toolValidator` - Pre-registration validation
