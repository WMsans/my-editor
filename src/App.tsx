import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

function App() {
  const [filename, setFilename] = useState("notes.md");
  const [status, setStatus] = useState("");
  const [peers, setPeers] = useState<string[]>([]);

  useEffect(() => {
    // 1. Fetch existing peers immediately on load
    invoke<string[]>("get_peers").then((currentPeers) => {
      setPeers((prev) => [...new Set([...prev, ...currentPeers])]);
    });

    // 2. Listen for new events
    const unlistenDiscovered = listen<string>("peer-discovered", (event) => {
      setPeers((prev) => [...new Set([...prev, event.payload])]);
      setStatus(`Found peer: ${event.payload.slice(0, 8)}...`);
    });

    const unlistenExpired = listen<string>("peer-expired", (event) => {
      setPeers((prev) => prev.filter((p) => p !== event.payload));
      setStatus(`Lost peer: ${event.payload.slice(0, 8)}...`);
    });

    return () => {
      unlistenDiscovered.then((f) => f());
      unlistenExpired.then((f) => f());
    };
  }, []);

  // Initialize Tiptap Editor with Markdown support
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown, // Enable markdown input/output
    ],
    content: "# Hello World\n\nStart editing...",
    editorProps: {
      attributes: {
        class: "editor-content", // Add a class for styling
      },
    },
  });

  // Function to Save content to disk via Rust
  async function saveFile() {
    if (!editor) return;

    // Get markdown content from Tiptap
    const content = editor.getMarkdown();

    try {
      await invoke("save_content", { path: filename, content });
      setStatus(`Saved to ${filename} at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      setStatus(`Error saving: ${error}`);
    }
  }

  // Function to Read content from disk via Rust
  async function loadFile() {
    if (!editor) return;

    try {
      const content = await invoke<string>("read_content", { path: filename });
      // Update editor content
      editor.commands.setContent(content);
      setStatus(`Loaded from ${filename}`);
    } catch (error) {
      setStatus(`Error loading: ${error}`);
    }
  }

  return (
    <main className="container">
      <h1>Tiptap + Tauri Editor</h1>

      <div className="row" style={{ marginBottom: "1rem", gap: "10px" }}>
        <input
          id="filename-input"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="Path to .md file"
        />
        <button onClick={loadFile}>Load</button>
        <button onClick={saveFile}>Save</button>
      </div>

      <div className="editor-wrapper">
        <EditorContent editor={editor} />
      </div>

      <p className="status-bar">{status}</p>

      <div className="status-bar">Peers: {peers.length}</div>
    </main>
  );
}

export default App;