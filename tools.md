# 🛠️ CAPACIDADES Y HERRAMIENTAS (`tools.md`)

Catálogo de habilidades (Skills) y extensiones disponibles para Silhouette OS.

---

## ⚡ Skills System (Habilidades Dinámicas)
Las habilidades se cargan dinámicamente desde tres fuentes:

1.  **Workspace Skills** (`.silhouette/skills/`): Habilidades específicas de este proyecto. Tienen la máxima prioridad.
2.  **Managed Skills** (`skills/`): Habilidades instaladas por el usuario globalmente.
3.  **Bundled Skills** (`universalprompts/`): Biblioteca base de prompts y capacidades (ej. CodeBuddy, VSCode Agent).

### Formato de Skill
Cada habilidad se define en un `SKILL.md` con metadatos YAML:
```yaml
---
name: "AnalistaDeCodigo"
description: "Revisa PRs y sugiere mejoras."
dispatch: "prompt" | "tool"
requires: ["read_file", "git"]
---
```

---

## 🔌 Plugins y Canales (Conectividad)

### Messaging Channels
*   **WhatsApp:** Conexión vía Baileys (Socket). Soporta texto y media.
*   **Telegram:** Bot oficial (Long-polling). Soporta comandos `/`.
*   **Discord:** Bot de servidor (Gateway). Soporta eventos de guild.

### Official Integrations (MCP)
Silhouette expone y consume recursos vía **Model Context Protocol (MCP)**:
*   `server/mcp/toolsets`: Acceso a herramientas internas vía API estandarizada.
*   `server/mcp/prompts`: Exposición de `universalprompts` como recursos MCP.

---

## 🧰 Herramientas Nativas (Core Tools)
Estas herramientas están "bakes in" en el binario del agente:

*   **FileSystem:** `read_file`, `write_to_file`, `list_dir`, `grep_search`.
*   **Browser:** `browser_action` (Puppeteer) para navegación real.
*   **Terminal:** `run_command` (Sandbox opcional) para ejecución de scripts.
*   **Memory:** `remember`, `recall`, `search_memory` (Acceso a Grafo/Vectores).

---
*Este catálogo define "qué puede hacer" Silhouette en un momento dado.*
