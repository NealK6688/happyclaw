---
name: install-skill
description: >
  Load when user requests to install a new skill — sends a skills.sh URL / GitHub URL /
  owner/repo / owner/repo@skill format. Extracts the package identifier and calls
  install_skill MCP tool.
  Do NOT load for: discussing what a skill does, uninstalling (call uninstall_skill directly),
  authoring new skill (use skill-craft).
user-invocable: false
---

# Skill Installation Guide

When a user asks to install a skill (e.g., sends a link, mentions a skill name, or says "install xxx skill"), follow this process:

## 1. Identify the Package Name

Parse the user's input to extract the `owner/repo` or `owner/repo@skill` format:

| Input Format | Example | Extract As |
|---|---|---|
| skills.sh URL | `https://skills.sh/s/owner/repo` | `owner/repo` |
| skills.sh skill URL | `https://skills.sh/s/owner/repo/skill-name` | `owner/repo@skill-name` |
| GitHub URL | `https://github.com/owner/repo` | `owner/repo` |
| GitHub tree URL | `https://github.com/owner/repo/tree/main/skills/name` | `owner/repo@name` |
| Direct package | `owner/repo` | `owner/repo` |
| Package with skill | `owner/repo@skill` | `owner/repo@skill` |

## 2. Install the Skill

Call the `install_skill` MCP tool with the extracted package name:

```
install_skill({ "package": "owner/repo" })
```

Or with a specific skill from the repo:

```
install_skill({ "package": "owner/repo@skill-name" })
```

## 3. Handle Results

**On success:**
- Tell the user which skill(s) were installed (use the `installed` array from the response)
- Briefly describe what the skill does (if you know from context)
- Mention they can manage it in the Skills page

**On failure:**
- Check if the package name format is correct
- Suggest the user verify the URL or package name
- Common issues:
  - Package not found: double-check the owner/repo spelling
  - Network error: ask user to retry
  - Invalid format: must be `owner/repo` or `owner/repo@skill`

## 4. Uninstalling

If the user wants to uninstall a skill, use the `uninstall_skill` MCP tool:

```
uninstall_skill({ "skill_id": "skill-name" })
```

The `skill_id` is the directory name of the installed skill.

## Evals

**正例**（should_load）：

- "装一下这个 skill: https://skills.sh/s/owner/repo" → load
- "Install this: github.com/anthropics/skills/tree/main/skills/code-review" → load
- "install travel-planner from owner/repo@travel-planner" → load
- "把这个 skill 加进来 owner/repo" → load
- "skill 地址：https://github.com/foo/bar" → load

**负例**（should NOT load）：

- "卸载 travel-planner skill" → uninstall_skill 直接调
- "这个 skill 是干嘛的" → 普通查询，读 SKILL.md 即可
- "我想新建一个 skill" → skill-craft（authoring）
- "怎么改这个 skill 的 description" → skill-craft（refactoring）

**已知失败**（沉淀为规则 / gotcha）：

- ❌ 用户给了完整 GitHub tree URL（含 `/tree/main/skills/...`）没正确提取 → 加 URL 格式解析表
- ❌ Install 完后没告诉用户在 Skills 页面可管理 → 加 Step 3 "mention manage in Skills page"
- ❌ uninstall 误触发本 skill → 加 negative scope（"uninstalling use uninstall_skill directly"）
