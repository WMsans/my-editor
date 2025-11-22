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
import { SlashMenu } from "./components/SlashMenu"; // Import the slash menu
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
      
      // Smart Load: Detect if it's our new JSON Block format or legacy Markdown
      try {
        const jsonContent = JSON.parse(content);
        // Check if it looks like a Tiptap document (has type: 'doc')
        if (jsonContent.type === 'doc' && Array.isArray(jsonContent.content)) {
          editor?.commands.setContent(jsonContent);
          console.log("Loaded as Block JSON");
        } else {
          throw new Error("Not a valid block document");
        }
      } catch (e) {
        // Fallback to Markdown for standard text files
        editor?.commands.setContent(content, { contentType: 'markdown' });
        console.log("Loaded as Markdown");
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
    // Default to .json for the new system to preserve block data
    const defaultName = currentFilePath || (rootPath ? `${rootPath}/untitled.json` : "untitled.json");
    const path = prompt("Enter full path to save file (use .json for full block support):", defaultName);
    
    if (path) {
      await saveToDisk(path);
      setCurrentFilePath(path);
    }
  };

  const saveToDisk = async (path: string) => {
    try {
      if (!editor) return;
      
      let content = "";
      
      // Smart Save: If the file ends in .json, save the full Block Structure.
      // Otherwise, try to export to Markdown (blocks may be lost or simplified).
      if (path.endsWith(".json")) {
        const json = editor.getJSON();
        content = JSON.stringify(json, null, 2); // Pretty print for debuggability
      } else {
         // Markdown fallback
         if (typeof (editor as any).getMarkdown === "function") {
           content = (editor as any).getMarkdown();
         } else if (editor.storage.markdown) {
           content = (editor.storage.markdown as any).getMarkdown();
         } else {
            content = editor.getText(); 
         }
      }

      await invoke("write_file_content", { path, content });
      setFileSystemRefresh(prev => prev + 1);
      // alert("Saved!"); // Optional: remove alert for smoother flow
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
             {/* Insert the Slash Menu for Block Selection */}
             {editor && <SlashMenu editor={editor} />}

            {editor && (
              <BubbleMenu 
                className="bubble-menu" 
                editor={editor}
              >
                <button onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'is-active' : ''}>Bold</button>
                <button onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'is-active' : ''}>Italic</button>
                <button onClick={() => editor.chain().focus().toggleCode().run()} className={editor.isActive('code') ? 'is-active' : ''}>Code</button>
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