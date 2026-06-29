---
name: monorepo-deployment-restructure
description: Workflow command scaffold for monorepo-deployment-restructure in free-swarm.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /monorepo-deployment-restructure

Use this workflow when working on **monorepo-deployment-restructure** in `free-swarm`.

## Goal

Restructure the repository to support unified monorepo deployment, especially for Vercel, including moving/renaming directories, updating build scripts, and configuring deployment routing.

## Common Files

- `package.json`
- `vercel.json`
- `next.config.js`
- `tailwind.config.js`
- `tsconfig.json`
- `app/`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Move or reorganize project directories (e.g., move website/ to root, keep frontend/ as /app, etc.)
- Update or create root-level build scripts in package.json to build all subprojects
- Update vercel.json to handle new routing and rewrites for each app
- Update or add configuration files (next.config.js, tailwind.config.js, tsconfig.json) at the root
- Remove or archive old subproject directories as needed

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.