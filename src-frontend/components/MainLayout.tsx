import React from "react";
import { Sidebar } from "./Sidebar";
import { EditorArea } from "./EditorArea";
import { MenuBar } from "./MenuBar";
import { Editor } from "@tiptap/react";

interface MainLayoutProps {
    editor: Editor | null;
    isJoining: boolean;
    isPushing: boolean;
    isSyncing: boolean;
    onNewFile: () => void;
    onOpenFolder: () => void;
    onSave: () => void;
    onQuit: () => void;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
    editor,
    isJoining,
    isPushing,
    isSyncing,
    onNewFile,
    onOpenFolder,
    onSave,
    onQuit
}) => {
  return (
    <div className="app-layout">
      <MenuBar 
        onNew={onNewFile}
        onOpenFolder={onOpenFolder}
        onQuit={onQuit}
        onSave={onSave}
      />
      
      <div className="main-workspace">
        <Sidebar />
        <EditorArea 
          editor={editor}
          isJoining={isJoining}
          isPushing={isPushing}
          isSyncing={isSyncing}
        />
      </div>
    </div>
  );
};