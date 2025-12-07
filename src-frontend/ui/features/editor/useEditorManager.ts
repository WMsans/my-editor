import { useState, useEffect } from "react";
import * as Y from "yjs";
import { workspaceManager } from "../../../core/services";
import { useCollaborativeEditor } from "./useCollaborativeEditor";

export function useEditorManager(
  currentFilePath: string | null, // Used only to detect "No file" state in UI
  isHost: boolean,
  isJoining: boolean
) {
  // 1. Listen to WorkspaceManager for the Active Document
  const [currentDoc, setCurrentDoc] = useState<Y.Doc>(() => new Y.Doc());
  
  useEffect(() => {
      // Initial load
      const initial = workspaceManager.getCurrentDoc();
      if (initial) setCurrentDoc(initial);
      else setCurrentDoc(new Y.Doc()); // Fallback for detached

      // Subscription
      const handler = (doc: Y.Doc | null) => {
          setCurrentDoc(doc || new Y.Doc());
      };
      
      workspaceManager.on('doc-changed', handler);
      return () => workspaceManager.off('doc-changed', handler);
  }, []);

  // 2. Initialize Editor with that Doc
  const { editor } = useCollaborativeEditor(currentDoc);

  // 3. Manage Editable State
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isJoining);
    }
  }, [editor, isJoining]);

  // Syncing state is now handled internally by P2PService/WorkspaceManager events usually
  // But for the specific "Syncing..." UI overlay, we can deduce it or listen to events.
  // For now, we simplify:
  const isSyncing = false; 

  return { 
    editor, 
    isSyncing, 
    currentDoc 
  };
}