import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import "./App.css";

function App() {
  const [filename, setFilename] = useState("notes.md");
  const [status, setStatus] = useState("");

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
    </main>
  );
}

export default App;