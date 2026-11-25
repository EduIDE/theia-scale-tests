# AGENTS.md

Playwright functional and scale tests for EduIDE installations.

## Terminology

Use the terms of the [EduIDE glossary](https://eduide.github.io/Docs/glossary) in code, UI texts, docs, values and comments, in exactly the meaning it gives.
Do not introduce synonyms (environment, instance, workspace, launch, lecturer, start page) for a term the glossary defines, and never write "frontend" or "backend".
When a new term is needed or a term changes, update the glossary in `EduIDE/Docs` first.
In test code, a running IDE is a session, a persistent volume is an IDEWorkspace, and a kind of IDE is a template.
