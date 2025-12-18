# my-editor
A high-performance, **plugin-first** collaborative editor built with Tauri, React, and TypeScript.

## Why my-editor?
**my-editor** isn't just another markdown editor; it's a powerful collaboration engine designed for the modern decentralized web.
- Serverless P2P Collaboration: Leverage real-time sync with Yjs and libp2p. Collaborate with peers directly without needing a centralized server.
- Plugin-First Architecture: The core is built to be lean. Every new feature is a plugin, rigorously validating our HostAPI as the single source of truth for extensions.
- Worker-First Execution: Computationally heavy plugin logic runs in Web Workers by default, ensuring your UI never lags, even during complex operations.
- Security-First Boundaries: Built-in protections distinguish between "Host" and "Guest" roles, preventing unauthorized file system modifications during collaborative sessions.
- Integrated Version Control: Native Git support allows you to pull, push, and manage repository states directly within the app.
- Rich Extension Surface: Powerful APIs to register custom Webview blocks, Slash Menu items, and custom TreeViews.
## Building Guide
**Prerequisites**
To build and develop my-editor, you will need:
- Rust: Install [Rust](https://rust-lang.org/tools/install/)
- Node.js: (v18+ recommended)
- Package Manager: pnpm is the preferred manager for this project.
- IDE Setup: VS Code with the Tauri and rust-analyzer extensions for the best experience.

**Installation**
1. Clone the repository:
```bash
git clone https://github.com/WMsans/my-editor
cd my-editor
```
2. Install dependencies:
```bash
pnpm install
```
### Running in Development
Start the Tauri development window with hot-reloading:
```bash
pnpm tauri dev
```
### Production Build
Generate a platform-specific executable:
```bash
pnpm tauri build
```
## Contribution Guide
We welcome contributions! However, to maintain the integrity of our architecture, all contributors must adhere to the **my-editor Constitution**:
1. Plugin-First: Do not add non-core logic to the main thread. Implement new features as standalone plugins.
2. Worker-First: All non-UI plugin logic must execute in a worker environment.
3. HostAPI Only: Side effects (file system, notifications, etc.) must only be performed through the provided HostAPI.
4. No any: We maintain strict TypeScript typing. Use of the any keyword in the core engine is prohibited.
5. Strict I/O: Only the host is permitted to execute manual file writes via documentRegistry and Tauri invoke calls.
For detailed principles, please review ```.specify/memory/constitution.md```.
