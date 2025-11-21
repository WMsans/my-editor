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
  
  // New State
  const [incomingRequest, setIncomingRequest] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(true); // Am I the host or guest?

  useEffect(() => {
    invoke<string[]>("get_peers").then((currentPeers) => {
      setPeers((prev) => [...new Set([...prev, ...currentPeers])]);
    });

    const unlistenDiscovered = listen<string>("peer-discovered", (event) => {
      setPeers((prev) => [...new Set([...prev, event.payload])]);
    });

    const unlistenExpired = listen<string>("peer-expired", (event) => {
      setPeers((prev) => prev.filter((p) => p !== event.payload));
    });

    // 1. Listen for Incoming Join Requests (Host Side)
    const unlistenRequest = listen<string>("join-requested", (event) => {
        setIncomingRequest(event.payload);
        setStatus(`Incoming request from ${event.payload.slice(0, 8)}...`);
    });

    // 2. Listen for Join Acceptance (Guest Side)
    const unlistenAccepted = listen<string>("join-accepted", (event) => {
        const content = event.payload;
        editor?.commands.setContent(content);
        setIsHost(false); // We are now a guest
        setStatus("Joined session! Editing shared doc.");
    });

    return () => {
      unlistenDiscovered.then((f) => f());
      unlistenExpired.then((f) => f());
      unlistenRequest.then((f) => f());
      unlistenAccepted.then((f) => f());
    };
  }, []);

  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: "# Hello World\n\nStart editing...",
    editorProps: { attributes: { class: "editor-content" } },
  });

  // --- Actions ---

  async function sendJoinRequest(peerId: string) {
      try {
          setStatus(`Requesting to join ${peerId.slice(0,8)}...`);
          await invoke("request_join", { peerId });
      } catch (e) {
          setStatus(`Error joining: ${e}`);
      }
  }

  async function acceptRequest() {
      if (!incomingRequest || !editor) return;
      try {
          const content = editor.getMarkdown();
          await invoke("approve_join", { peerId: incomingRequest, content });
          setIncomingRequest(null);
          setStatus(`Accepted ${incomingRequest.slice(0,8)}`);
      } catch (e) {
          setStatus(`Error accepting: ${e}`);
      }
  }

  return (
    <main className="container">
      <h1>P2P Editor {isHost ? "(Host)" : "(Guest)"}</h1>
      
      {/* Peer List with Join Buttons */}
      <div style={{ marginBottom: "1rem" }}>
        <h3>Peers</h3>
        <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
            {peers.length === 0 && <small>Scanning...</small>}
            {peers.map(peer => (
                <div key={peer} style={{ border: "1px solid #333", padding: "5px 10px", borderRadius: "4px" }}>
                    <span>{peer.slice(0, 6)}... </span>
                    <button onClick={() => sendJoinRequest(peer)}>Join</button>
                </div>
            ))}
        </div>
      </div>

      {/* Incoming Request Modal/Alert */}
      {incomingRequest && (
          <div style={{ background: "#313244", padding: "1rem", margin: "1rem", borderRadius: "8px", border: "1px solid #89b4fa" }}>
              <p><strong>{incomingRequest.slice(0,8)}...</strong> wants to join your session.</p>
              <button onClick={acceptRequest} style={{ background: "#a6e3a1", color: "#1e1e2e" }}>Accept</button>
              <button onClick={() => setIncomingRequest(null)} style={{ marginLeft: "10px", background: "#f38ba8", color: "#1e1e2e" }}>Reject</button>
          </div>
      )}

      <div className="editor-wrapper">
        <EditorContent editor={editor} />
      </div>
      <p className="status-bar">{status}</p>
    </main>
  );
}

export default App;