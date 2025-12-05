import { HostAPI } from "../../src-frontend/mod-engine/types";

export function activate(context: HostAPI) {
  const BLOCK_ID = 'slope-block';

  // --- Register the Webview Block ---
  // Points to 'webview.html' which will be served via plugin://slope/webview.html
  context.editor.registerWebviewBlock(BLOCK_ID, {
    entryPoint: "webview.html", 
    attributes: {
      // We can add default attributes here if needed in the future
      height: { default: "600px" }
    }
  });

  // --- Register Insert Command ---
  context.commands.registerCommand("slope.insert", (args: any) => {
    const content = { type: BLOCK_ID };
    if (args && args.range) {
        context.editor.insertContentAt(args.range, content);
    } else {
        context.editor.insertContent(content);
    }
  });
}