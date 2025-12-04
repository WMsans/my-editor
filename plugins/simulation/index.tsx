import { HostAPI } from "../../src-frontend/mod-engine/types";

export function activate(context: HostAPI) {
  const BLOCK_ID = 'simulationBlock';

  // --- 1. Define the Webview UI (HTML/CSS) ---
  const html = `
    <div class="sim-container">
      <div class="header">
        <span class="title">🖥️ Simulation Node (Worker)</span>
        <button id="run-btn">▶ Run</button>
      </div>
      <div class="body">
        <textarea id="editor" spellcheck="false" placeholder="// Write JS here..."></textarea>
        <div class="canvas-box">
          <canvas id="canvas" width="300" height="200"></canvas>
          <div id="error" class="error-toast"></div>
        </div>
      </div>
    </div>
    <style>
      :root { 
        --bg: #181825; --header: #313244; --text: #cdd6f4; 
        --accent: #89b4fa; --error: #f38ba8; 
      }
      body { margin: 0; overflow: hidden; background: var(--bg); color: var(--text); font-family: sans-serif; }
      .sim-container { display: flex; flex-direction: column; height: 100%; border-radius: 4px; overflow: hidden; }
      .header { 
        background: var(--header); padding: 6px 10px; 
        display: flex; justify-content: space-between; align-items: center; 
        font-size: 0.8rem; font-weight: bold; border-bottom: 1px solid #45475a;
      }
      button { 
        background: var(--accent); color: #1e1e2e; border: none; 
        padding: 4px 10px; border-radius: 4px; font-weight: bold; cursor: pointer; 
      }
      button:hover { opacity: 0.9; }
      .body { display: flex; flex: 1; min-height: 0; }
      textarea { 
        flex: 1; background: #11111b; color: #a6e3a1; border: none; 
        padding: 10px; resize: none; outline: none; font-family: monospace; 
      }
      .canvas-box { 
        flex: 1; background: #000; position: relative; 
        display: flex; align-items: center; justify-content: center; 
      }
      .error-toast { 
        position: absolute; bottom: 0; left: 0; right: 0; 
        background: rgba(243, 139, 168, 0.9); color: #1e1e2e; 
        padding: 5px; font-size: 0.75rem; display: none; 
      }
    </style>
  `;

  // --- 2. Define the Logic (Script) ---
  const script = `
    const editor = document.getElementById('editor');
    const runBtn = document.getElementById('run-btn');
    const canvas = document.getElementById('canvas');
    const errorBox = document.getElementById('error');

    // Default Code
    const DEFAULT_CODE = "// Draw something cool\\nconst ctx = canvas.getContext('2d');\\nctx.fillStyle = '#89b4fa';\\nctx.fillRect(50, 50, 100, 100);";

    // 1. Initialize from Attributes
    editor.value = window.initialAttrs.code || DEFAULT_CODE;

    // 2. Sync Code Changes back to Editor
    editor.addEventListener('input', () => {
      window.updateAttributes({ code: editor.value });
    });

    // Handle Remote Updates
    window.addEventListener('message', (e) => {
       if (e.data && e.data.type === 'SYNC_ATTRS') {
           const newCode = e.data.attrs.code;
           // Avoid overwriting if identical (prevents cursor jumping for local user)
           if (editor.value !== newCode) {
               editor.value = newCode || "";
           }
       }
    });

    // 3. Handle Run
    const runSimulation = () => {
      const code = editor.value;
      errorBox.style.display = 'none';
      canvas.width = canvas.width; // Clear canvas

      try {
        const func = new Function("canvas", "console", code);
        func(canvas, { 
          log: (...args) => console.log('[Sim]', ...args) 
        });
      } catch (e) {
        errorBox.textContent = e.toString();
        errorBox.style.display = 'block';
      }
    };

    runBtn.addEventListener('click', runSimulation);

    // 4. Hotkeys (Ctrl+Enter to Run)
    editor.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Stop Tiptap interference
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        runSimulation();
      }
    });

    // Auto-run if content exists
    if (window.initialAttrs.code) setTimeout(runSimulation, 100);
  `;

  // --- 3. Register the Block ---
  context.editor.registerWebviewBlock(BLOCK_ID, {
    initialHtml: html,
    initialScript: script,
    attributes: {
      code: { default: null }
    }
  });

  // --- 4. Register Insert Command ---
  context.commands.registerCommand("simulation.insert", () => {
    // We added 'insertContent' to HostAPI to support worker logic
    context.editor.insertContent({ type: BLOCK_ID });
  });
}