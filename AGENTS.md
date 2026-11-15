<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Extensions

Behaviour that a downstream build may replace goes through `src/extensions/`
only. No build-specific env flags or `if` switches anywhere else. Before touching
`src/extensions/`, any `ext.*` or `staticExt.*` read, or anything that should be
replaceable, load the `changing-the-extension-seam` skill.
