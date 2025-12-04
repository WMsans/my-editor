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
  requestSync: (path: string) => Promise<void>,
  isAppReady: boolean // [FIX] Add param
) {
  const [currentDoc, setCurrentDoc] = useState<Y.Doc>(() => new Y.Doc());
  const [isSyncing, setIsSyncing] = useState(false);
  
  const relativeFilePath = getRelativePath(currentFilePath);
  
  // [FIX] Pass isAppReady to editor hook
  const { editor } = useCollaborativeEditor(currentDoc, isAppReady);

  // Manage Editable State
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isJoining);
    }
  }, [editor, isJoining]);

  // Effect 1: Handle Document Loading (Separated from Syncing)
  useEffect(() => {
    if (relativeFilePath) {
      const doc = documentRegistry.getOrCreateDoc(relativeFilePath);
      setCurrentDoc(doc);
    } else {
      // For new/untitled files, create a fresh detached document
      // This will only run when switching to a "new file" state
      setCurrentDoc(new Y.Doc());
    }
  }, [relativeFilePath]); // Only depends on the file path, not syncing props

  // Effect 2: Handle Syncing
  useEffect(() => {
    if (relativeFilePath) {
      // If guest, request sync for this file
      if (!isHost && requestSync) {
        requestSync(relativeFilePath);
        setIsSyncing(true);
      } else {
        setIsSyncing(false);
      }
    } else {
      setIsSyncing(false);
    }
  }, [relativeFilePath, isHost, requestSync]);

  return { 
    editor, 
    isSyncing, 
    setIsSyncing,
    currentDoc 
  };
}