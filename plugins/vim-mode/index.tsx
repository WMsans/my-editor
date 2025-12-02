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
                  // context.ui.showNotification("VIM: Normal Mode");
                  view.focus(); 
                  return true; 
                }
                return false; 
              }

              // 2. Normal Mode Logic (Intercept Everything)
              
              if (event.key === 'i') {
                mode = 'insert';
                // context.ui.showNotification("VIM: Insert Mode");
                return true;
              }

              if (event.key === 'a') {
                if (dispatch) {
                   const newPos = Math.min(doc.content.size, selection.from + 1);
                   const tr = state.tr.setSelection(TextSelection.create(doc, newPos));
                   dispatch(tr);
                }
                mode = 'insert';
                // context.ui.showNotification("VIM: Insert Mode");
                return true;
              }

              // Navigation (HJKL)
              if (['h', 'j', 'k', 'l'].includes(event.key)) {
                
                if (event.key === 'h') {
                    // Left
                    if (dispatch) {
                        const newPos = Math.max(0, selection.from - 1);
                        dispatch(state.tr.setSelection(TextSelection.create(doc, newPos)));
                    }
                }
                if (event.key === 'l') {
                    // Right
                    if (dispatch) {
                        const newPos = Math.min(doc.content.size, selection.from + 1);
                        dispatch(state.tr.setSelection(TextSelection.create(doc, newPos)));
                    }
                }
                
                // Vertical Navigation Fix
                if (event.key === 'j' || event.key === 'k') {
                    const startCoords = view.coordsAtPos(selection.from);
                    // Estimate line height from current cursor size. Default to 20 if 0.
                    const lineHeight = (startCoords.bottom - startCoords.top) || 20;
                    
                    // We jump by full line height + padding to clear inter-line margins (0.5em ~ 8px)
                    // Down: From bottom + 10px (clears margin)
                    // Up: From top - 10px (clears margin)
                    const verticalStep = Math.max(lineHeight, 15);

                    const targetY = event.key === 'j' 
                        ? startCoords.bottom + verticalStep
                        : startCoords.top - verticalStep;

                    const targetPos = view.posAtCoords({ 
                        left: startCoords.left, 
                        top: targetY
                    });
                    
                    if (targetPos && dispatch) {
                         const tr = state.tr.setSelection(TextSelection.create(doc, targetPos.pos));
                         dispatch(tr.scrollIntoView());
                    }
                }
                
                return true;
              }

              if (event.ctrlKey || event.metaKey || event.altKey) return false;
              if (event.key.startsWith("Arrow")) return false; 
              if (event.key.length === 1) return true; 

              return false;
            }
          }
        })
      ];
    },
  });

  context.editor.registerExtension(VimExtension, { priority: 'high' });
  context.ui.showNotification("Vim Mode Loaded (Press 'i' to insert, 'Esc' for normal)");
}

export function deactivate() {}