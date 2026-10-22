# Tools for seeing how the code works

Researched against official project/product pages on 22 October 2026. No external indexing service has been connected and no application dependency or editor extension has been installed for this guide.

## Understand the different kinds of maps

- **Architecture map:** frontend, API, database, providers and their responsibilities.
- **Import/dependency map:** which source module imports another. Automatically extractable, but does not prove runtime execution.
- **Sequence diagram:** what happens for a chosen user action, including retries and failure branches.
- **Runtime trace:** what executed for one actual request. Requires instrumentation/debugging, not just reading imports.
- **Database ER diagram:** tables, keys and relationships.

No static import graph alone explains every business rule, dynamic request, runtime value or failure case.

## Options

| Tool | Best use | What to expect / limitation |
|---|---|---|
| Mermaid diagrams | Source-controlled architecture, sequence and ER diagrams | We already use it in this guide. Text-to-diagram rendering; the explanatory flows must be checked against code. No third-party source upload is needed to author the files locally. |
| CodeViz | Interactive architecture exploration in VS Code | Its official site describes source-linked architecture models and on-demand API/data-flow views. Suitable if you want to click through a visual codebase. Check current plan, authentication and code-access policy before connecting. |
| dependency-cruiser | Local JS/TS module dependency graphs and architecture rules | Strong for import relationships, grouping and boundary checks. It will not infer the whole booking/payment business lifecycle. |
| Madge | Quick dependency and circular-import graphs | Useful for a focused module graph. Its documented visual-image workflow requires Graphviz; do not confuse a package graph with a feature execution flow. |
| DeepWiki | Generated repository documentation and conversational exploration | Useful for explanations and diagrams over an indexed repository. It is an external indexing workflow; access requirements differ for public/private repositories. Generated answers still need source verification. |

Official sources:

- [Mermaid documentation](https://mermaid.js.org/intro/)
- [CodeViz](https://www.codeviz.ai/)
- [dependency-cruiser repository and documentation](https://github.com/sverweij/dependency-cruiser)
- [Madge documentation](https://github.com/pahen/madge)
- [DeepWiki repository documentation](https://docs.devin.ai/work-with-devin/deepwiki)

## What is already provided for EventPoint

1. Human-readable architecture and feature sequence diagrams in [03-architecture-and-flows.md](03-architecture-and-flows.md).
2. A small, local, repeatable mapper using the repository's existing TypeScript installation. It parses reachable API imports without executing the application or connecting to the database.
3. Its [generated API map](generated-api-map.md), including its scope and limitations.

To refresh the import map from the repository root:

```powershell
node docs/project-in-depth/generate-code-map.cjs
```

This command only rewrites the study map. It does not start the application, run tests, modify the database or deploy.

## Recommended approach for your interviews

Start with the checked feature-flow diagrams and source-linked study guide. Use the generated import map when locating code. If you want a richer clickable editor experience later, evaluate CodeViz; if you want stronger local dependency analysis, evaluate dependency-cruiser. No extra skill installation is necessary to begin learning this project.

For runtime behavior, use a debugger and the browser Network panel on a safe local environment. Do not make real purchases or modify production just to illustrate a diagram.
