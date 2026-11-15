# Standard for Silhouette Skills (`SKILL.md`)

This document defines the standard for creating **Skills** in Silhouette.
A Skill is a **prompt-based capability** that teaches the Agent how to perform a specific task using natural language and existing tools.

## 1. Structure
A skill is a folder in `src/skills/` or `.silhouette/skills/` containing a `SKILL.md` file.

### Frontmatter (YAML)
Every `SKILL.md` MUST start with YAML frontmatter:

```yaml
---
name: skill_name_snake_case
description: Brief description of what this skill does (1 sentence).
user-invocable: true  # Can the user call this directly?
command-dispatch: prompt # 'prompt' (inject instructions) or 'tool' (map to a tool)
tags: [tag1, tag2]
requires: [tool_checkout_code, tool_browser] # Optional: Tools this skill depends on
---
```

### Body (Instructions)
The body contains the **System Prompt Injection**.
*   Use clear, imperative language.
*   Define specific steps.
*   Provide examples of use.

## 2. Example: `PR Reviewer`

**File:** `.silhouette/skills/pr_reviewer/SKILL.md`

```markdown
---
name: pr_reviewer
description: Reviews a GitHub Pull Request for code quality and security.
user-invocable: true
tags: [github, dev, review]
requires: [github_get_pr, github_add_review]
---

# PR Reviewer Skill

You are an expert Senior Software Engineer. Your goal is to review a Pull Request.

## Algorithm
1.  **Fetch PR Details**: Use `github_get_pr` to get title, description, and file changes.
2.  **Analyze Changes**:
    *   Check for security vulnerabilities (SQLi, XSS).
    *   Check for code style and comprehensive error handling.
    *   Look for missing tests.
3.  **Submit Review**:
    *   If critical issues found: Request Changes.
    *   If minor issues: Comment.
    *   If looks good: Approve.
    *   Use `github_add_review` to submit.

## Tone
Constructive, professional, and rigorous.
```

## 3. Best Practices
1.  **Single Responsibility**: One skill per folder.
2.  **Self-Contained**: Don't rely on implicit context.
3.  **Tool usage**: Explicitly name the tools the agent should use.
