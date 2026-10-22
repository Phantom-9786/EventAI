# Tools for seeing how the code fits together

Reviewed against the tools' own documentation on 22 October 2026. A diagram, a guided reading tour and a runtime debugger answer different questions.

## Which tool answers which question?

| Tool | Useful view | Fit for EventPoint | Limit |
|---|---|---|---|
| Mermaid diagrams in this folder | Architecture, relationships and request sequences | Already prepared; easy to keep beside code | Authored explanation, not a recording of execution |
| Microsoft CodeTour for VS Code | Guided, clickable steps attached to real files and lines | Four ready tours are in `.tours/` | Explains selected paths; does not execute code |
| dependency-cruiser | Extracted JavaScript/TypeScript import/dependency graphs; supports Mermaid output | Useful for inspecting module coupling and shared packages | Imports do not reveal dynamic control flow or prove a request actually called a function |
| VS Code JavaScript/Node debugger | Breakpoints, call stack, variables and stepping | Best fit for seeing what happens inside one actual API request | Requires running/attaching to the application; a paused request is not a complete architecture map |
| GitDiagram | AI-generated interactive repository architecture, with links to code | Useful as a second view of the GitHub repository | AI-inferred structure should be checked against code; it is not an execution trace |
| tldraw integration | Editable architecture canvas with agent-assisted drawing | Connected; the six-page learning board is linked below | A canvas does not automatically instrument the backend |

## Recommended combination

1. **Start with the existing Mermaid maps** to understand the whole project.
2. **Use the CodeTour files** to read one feature in a sensible order.
3. **Use the built-in VS Code debugger** when you want to inspect actual arguments, branches and database results in a local development run.
4. Use **dependency-cruiser** when your question is about imports and dependencies.
5. Treat **GitDiagram** as a convenient architecture draft, not a substitute for understanding the booking and AI flows.

You do not need another paid tool, skill or service to begin learning this project. During the initial preparation, no application dependency, extension, MCP server or external code upload was installed/performed; tldraw was only a suggestion at that point. The subsequent visual update connected tldraw and installed Microsoft's CodeTour extension with the user's authorization. No application dependency was added.

## Visual update: 22 October 2026

- **CodeTour v0.0.61** is installed in the local VS Code. Four tours contain 38 source stops.
- [EventPoint — Visual Learning Atlas](https://www.tldraw.com/f/RNvB-ohzBfBU19zsxH5is) contains six editable pages: overview, search, authentication, booking, AI and delivery. It contains authored explanations, not a runtime recording or a repository upload.
- [The portable atlas](index.html) works offline. Download or clone the repository and open it in your browser; GitHub itself shows its HTML source.
- [SVG diagrams](visual-gallery.md) render on GitHub. Their `.mmd` sources, atlas data and builder are stored in `visuals/` and this folder.
- Rebuild the generated atlas after editing its source with `node docs/interview-preparation/build-atlas.cjs` from the repository root. This documentation builder does not start the application or contact external services.

## Start the guided tours

**CodeTour**, published by Microsoft, is installed locally. On another computer, install it in VS Code. Open this repository and run **CodeTour: Start Tour** from the Command Palette.

Prepared tours:

- **01 — Architecture and browsing**: page → frontend API → Express → event search → schema → card.
- **02 — Booking and payment correctness**: widget → server price → atomic stock reservation → verification → expiry.
- **03 — AI and RAG**: chat → interpretation/context → business filters → local embeddings → factual passages.
- **04 — Authentication and delivery**: browser access token → server auth → role checks → CI and hosting boundaries.

Tour line numbers reflect this source revision and should be updated if later code moves. The descriptions identify function names so you can still locate the relevant section.

## What “actual code working” means

Use a breakpoint on a development API request to inspect:

1. Its validated input.
2. The authenticated user and ownership decision.
3. The chosen service function and branch.
4. The database read/write parameters.
5. The result or thrown error.

For a booking, compare two concurrent requests and the conditional inventory update. For AI, inspect the validated filter and retrieved evidence before the provider call. This makes the diagram concrete without assuming a dependency graph can show time, actual values or external provider responses.

## Official references

- [CodeTour documentation and extension project](https://github.com/microsoft/codetour)
- [dependency-cruiser project](https://github.com/sverweij/dependency-cruiser)
- [dependency-cruiser CLI and Mermaid output](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md)
- [VS Code Node.js debugging](https://code.visualstudio.com/docs/nodejs/nodejs-debugging)
- [GitDiagram project and current integrations](https://github.com/ahmedkhaleel2004/gitdiagram)

These links describe the tools. The actual EventPoint maps are based on local source, not generated by sending the repository to one of these services.
