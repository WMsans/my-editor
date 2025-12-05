import { HostAPI } from "../../src-frontend/mod-engine/types";

export function activate(context: HostAPI) {
  const BLOCK_ID = 'simulation-block-view';

  // --- Register the Webview Block ---
  // We now use 'entryPoint' to load the HTML file via the custom plugin:// protocol
  context.editor.registerWebviewBlock(BLOCK_ID, {
    entryPoint: "webview.html", 
    attributes: {
      code: { default: null }
    }
  });

  // --- Register Insert Command ---
  context.commands.registerCommand("simulation.insert", (args: any) => {
    const content = { type: BLOCK_ID };
    if (args && args.range) {
        context.editor.insertContentAt(args.range, content);
    } else {
        context.editor.insertContent(content);
    }
  });
}