<!--
Sync Impact Report:
- Version change: 0.0.0 → 1.0.0
- Added sections:
    - I. Plugin-First Architecture
    - II. Worker-First Execution
    - III. Restricted Main-Thread Access
    - IV. HostAPI as Sole Bridge
    - V. Guest-Host I/O Boundary
    - VI. Strict Typing in Core
- Templates requiring updates:
    - ✅ .specify/templates/plan-template.md
    - ✅ .specify/templates/spec-template.md
    - ✅ .specify/templates/tasks-template.md
-->
# my-editor Constitution
<!-- This document outlines the core principles and governance for the my-editor project. -->

## Core Principles

### I. Plugin-First Architecture
New, non-core logic must be implemented as a standalone plugin or extension to rigorously validate the HostAPI as the single extension surface.

### II. Worker-First Execution
The worker environment is the default execution context for all plugins, ensuring that heavy computation or unstable third-party logic cannot block the main UI thread.

### III. Restricted Main-Thread Access
Main-thread plugin execution is strictly reserved for necessary UI rendering, direct DOM manipulation, or integration that absolutely requires access to the react or @tiptap/react modules.

### IV. HostAPI as Sole Bridge
Plugins must rely exclusively on the HostAPI for all side effects, including file system access (data.fs) and command execution, to maintain isolation and enforce permission checks.

### V. Guest-Host I/O Boundary
Only the host is permitted to execute manual documentRegistry.manualSave() and Tauri invoke calls for file writing, protecting guests from unintended local file changes.

### VI. Strict Typing in Core
No `any` in Core: Strict TypeScript typing must be maintained in the core engine (mod-engine/types.ts) to ensure type safety between the main thread, the worker thread, and the HostAPI implementation.

## Governance
<!-- This constitution is the single source of truth for all development practices. -->

All pull requests and code reviews must verify compliance with these principles. Any deviation from these principles must be explicitly justified and approved.

**Version**: 1.0.0 | **Ratified**: 2025-12-04 | **Last Amended**: 2025-12-04