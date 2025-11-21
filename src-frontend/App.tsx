import { useState } from "react";
import { EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus" 
import { useCollaborativeEditor } from "./hooks/useCollaborativeEditor";
import { useP2P } from "./hooks/useP2P";
import { PeerList } from "./components/PeerList";
import { IncomingRequest } from "./components/IncomingRequest";
import { FileExplorer } from "./components/FileExplorer";
import { MenuBar } from "./components/MenuBar";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const { editor, ydoc } = useCollaborativeEditor();
  const { 
    peers, 
    incomingRequest, 
    isHost, 
    status, 
    sendJoinRequest, 
    acceptRequest, 
    rejectRequest 
  } = useP2P(ydoc);

  const [rootPath, setRootPath] = useState<string>("");
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [fileSystemRefresh, setFileSystemRefresh] = useState(0);

  // -- File Operations --

  const handleOpenFolder = async () => {
    const path = prompt("Enter absolute folder path to open:");
    if (path) {
      setRootPath(path);
      setFileSystemRefresh(prev => prev + 1);
    }
  };

  const handleOpenFile = async (path: string) => {
    try {
      const content = await invoke<string>("read_file_content", { path });
      
      if (editor) {
        // Fix: Load content as raw text paragraphs to support "Live Preview"
        // We manually construct the JSON to avoid the Markdown parser consuming syntax.
        const lines = content.split("\n");
        const docContent = lines.map(line => ({
          type: "paragraph",
          content: line ? [{ type: "text", text: line }] : []
        }));

        editor.commands.setContent({
          type: "doc",
          content: docContent
        });
      }
      
      setCurrentFilePath(path);
    } catch (e) {
      alert("Error opening file: " + e);
    }
  };

  const handleNewFile = () => {
    editor?.commands.clearContent();
    setCurrentFilePath(null);
  };

  const handleSave = async () => {
    if (!currentFilePath) {
      handleSaveAs();
      return;
    }
    await saveToDisk(currentFilePath);
  };

  const handleSaveAs = async () => {
    const defaultName = currentFilePath || (rootPath ? `${rootPath}/untitled.md` : "untitled.md");
    const path = prompt("Enter full path to save file:", defaultName);
    
    if (path) {
      await saveToDisk(path);
      setCurrentFilePath(path);
    }
  };

  const saveToDisk = async (path: string) => {
    try {
      if (!editor) return;
      
      // Fix: Use getText with specific block separator to preserve raw markdown
      // and avoid Tiptap adding double newlines by default.
      const content = editor.getText({ blockSeparator: "\n" });

      await invoke("write_file_content", { path, content });
      setFileSystemRefresh(prev => prev + 1);
      alert("Saved!");
    } catch (e) {
      alert("Error saving: " + e);
    }
  };

  return (
    <div className="app-layout">
      <MenuBar 
        onNew={handleNewFile}
        onOpenFolder={handleOpenFolder}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        currentFile={currentFilePath}
      />
      
      <div className="main-workspace">
        {/* Sidebar */}
        <aside className="sidebar">
           <FileExplorer 
             rootPath={rootPath} 
             onOpenFile={handleOpenFile} 
             refreshTrigger={fileSystemRefresh} 
           />
           
           <div className="p2p-panel">
              <h3>P2P Status: {isHost ? "Host" : "Guest"}</h3>
              <p className="status-text">{status}</p>
              <PeerList peers={peers} onJoin={sendJoinRequest} />
              {incomingRequest && (
                <IncomingRequest 
                  peerId={incomingRequest} 
                  onAccept={acceptRequest} 
                  onReject={rejectRequest} 
                />
              )}
           </div>
        </aside>

        {/* Editor Area */}
        <main className="editor-container">
          <div className="editor-scroll-area">
            {editor && (
              <BubbleMenu 
                className="bubble-menu" 
                editor={editor}
              >
                <button
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  className={editor.isActive('bold') ? 'is-active' : ''}
                >
                  Bold
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  className={editor.isActive('italic') ? 'is-active' : ''}
                >
                  Italic
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                  className={editor.isActive('strike') ? 'is-active' : ''}
                >
                  Strike
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleCode().run()}
                  className={editor.isActive('code') ? 'is-active' : ''}
                >
                  Code
                </button>
              </BubbleMenu>
            )}
            <EditorContent editor={editor} />
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;