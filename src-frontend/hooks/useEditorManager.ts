import { useState, useEffect } from "react";
import * as Y from "yjs";
import { documentRegistry } from "../mod-engine/DocumentRegistry";
import { useCollaborativeEditor } from "./useCollaborativeEditor";

export function useEditorManager(
  rootPath: string,
  currentFilePath: string | null,
  getRelativePath: (path: string | null) => string | null,
  isHost: boolean,
  isJoining: boolean,
  requestSync: (path: string) => Promise<void>
) {
  const [currentDoc, setCurrentDoc] = useState<Y.Doc | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const relativeFilePath = getRelativePath(currentFilePath);
  
  // Initialize Editor
  const { editor } = useCollaborativeEditor(currentDoc);

  // Manage Editable State
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isJoining);
    }
  }, [editor, isJoining]);

  // Load Document & Sync
  useEffect(() => {
    if (relativeFilePath) {
      const doc = documentRegistry.getOrCreateDoc(relativeFilePath);
      setCurrentDoc(doc);
      
      // If guest, request sync for this file
      if (!isHost && requestSync) {
        requestSync(relativeFilePath);
        setIsSyncing(true);
      } else {
        setIsSyncing(false);
      }
    } else {
      setCurrentDoc(null);
    }
  }, [relativeFilePath, isHost, requestSync]);

  return { 
    editor, 
    isSyncing, 
    setIsSyncing 
  };
}