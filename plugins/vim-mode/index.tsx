import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state"; 

export function activate(context: any) {
  
  const VimExtension = Extension.create({
    name: 'vimMode',

    addProseMirrorPlugins() {
      let mode = 'normal'; // 'normal' | 'insert'

      return [
        new Plugin({
          key: new PluginKey('vim-mode'),
          props: {
            handleKeyDown: (view, event) => {
              const { state, dispatch } = view;
              const { selection, doc } = state;

              // 1. Insert Mode Logic
              if (mode === 'insert') {
                if (event.key === 'Escape') {
                  mode = 'normal';
                  context.ui.showNotification("VIM: Normal Mode");
                  // Ensure we focus back to properly capture keys
                  view.focus(); 
                  return true; 
                }
                return false; 
              }

              // 2. Normal Mode Logic (Intercept Everything)
              
              // i: Insert at cursor
              if (event.key === 'i') {
                mode = 'insert';
                context.ui.showNotification("VIM: Insert Mode");
                return true;
              }

              // a: Append (move right then insert)
              if (event.key === 'a') {
                if (dispatch) {
                   // Calculate position + 1 (ensure we don't go out of bounds)
                   const newPos = Math.min(doc.content.size, selection.from + 1);
                   const tr = state.tr.setSelection(TextSelection.create(doc, newPos));
                   dispatch(tr);
                }
                mode = 'insert';
                context.ui.showNotification("VIM: Insert Mode");
                return true;
              }

              // Navigation (HJKL)
              if (['h', 'j', 'k', 'l'].includes(event.key)) {
                // We use Tiptap commands for navigation to leverage View-based layout logic
                // (especially for J/K vertical movement which requires layout awareness)
                const editor = context.editor.getSafeInstance();
                if (!editor) return false;

                if (event.key === 'h') {
                    // Left
                    editor.commands.command(({ tr, dispatch }: any) => {
                        if (dispatch) {
                            const newPos = Math.max(0, selection.from - 1);
                            dispatch(tr.setSelection(TextSelection.create(doc, newPos)));
                        }
                        return true;
                    });
                }
                if (event.key === 'l') {
                    // Right
                    editor.commands.command(({ tr, dispatch }: any) => {
                        if (dispatch) {
                            const newPos = Math.min(doc.content.size, selection.from + 1);
                            dispatch(tr.setSelection(TextSelection.create(doc, newPos)));
                        }
                        return true;
                    });
                }
                if (event.key === 'j') {
                    // Down (Relies on Tiptap/ProseMirror view logic)
                    editor.commands.focus('down');
                }
                if (event.key === 'k') {
                    // Up
                    editor.commands.focus('up');
                }
                
                return true;
              }

              // Block other keys in Normal mode
              if (event.ctrlKey || event.metaKey || event.altKey) return false;
              if (event.key.startsWith("Arrow")) return false; // Allow default arrows
              if (event.key.length === 1) return true; // Block typing

              return false;
            }
          }
        })
      ];
    },
  });

  // REGISTER AS HIGH PRIORITY
  context.editor.registerExtension(VimExtension, { priority: 'high' });
  context.ui.showNotification("Vim Mode Loaded (Press 'i' to insert, 'Esc' for normal)");
}

export function deactivate() {}