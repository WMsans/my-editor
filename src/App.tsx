import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration"; // New dependency
import * as Y from "yjs"; // New dependency
import { listen } from "@tauri-apps/api/event";
import "./App.css";

function App() {
  const [status, setStatus] = useState("");
  const [peers, setPeers] = useState<string[]>([]);
  const [incomingRequest, setIncomingRequest] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(true);

  // 1. Initialize Yjs Document
  const ydoc = useMemo(() => new Y.Doc(), []);

  useEffect(() => {
    // Setup P2P Listener for Peer Discovery
    invoke<string[]>("get_peers").then((currentPeers) => {
      setPeers((prev) => [...new Set([...prev, ...currentPeers])]);
    });

    const listeners = [
      listen<string>("peer-discovered", (e) => setPeers((prev) => [...new Set([...prev, e.payload])])),
      listen<string>("peer-expired", (e) => setPeers((prev) => prev.filter((p) => p !== e.payload))),
      
      // Handle Join Requests
      listen<string>("join-requested", (e) => {
        setIncomingRequest(e.payload);
        setStatus(`Incoming request from ${e.payload.slice(0, 8)}...`);
      }),

      // Handle Join Accepted (Guest Side)
      listen<number[]>("join-accepted", (e) => {
        // Apply the initial state received from Host
        Y.applyUpdate(ydoc, new Uint8Array(e.payload));
        setIsHost(false);
        setStatus("Joined session! Editing shared doc.");
      }),

      // Handle Host Disconnect
      listen<string>("host-disconnected", (e) => {
        setStatus(`⚠ Host ${e.payload.slice(0, 8)} disconnected!`);
        setIsHost(true);
      }),

      // NEW: Handle Incoming Yjs Sync Updates
      listen<number[]>("p2p-sync", (e) => {
        // Apply incremental update from peer
        const update = new Uint8Array(e.payload);
        Y.applyUpdate(ydoc, update);
      })
    ];

    return () => {
      listeners.forEach(l => l.then(unlisten => unlisten()));
    };
  }, [ydoc]);

  // 2. Hook up Yjs to Tiptap
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // @ts-ignore
        history: false, 
      }),
      Collaboration.configure({
        document: ydoc,
      }),
    ],
    editorProps: { attributes: { class: "editor-content" } },
  });

  // 3. Capture Local Updates and Broadcast
  useEffect(() => {
    const handleUpdate = (update: Uint8Array) => {
      // Convert Uint8Array to regular array for Tauri serialization
      invoke("broadcast_update", { data: Array.from(update) })
        .catch(e => console.error("Broadcast failed", e));
    };

    ydoc.on('update', handleUpdate);
    return () => { ydoc.off('update', handleUpdate); };
  }, [ydoc]);

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
      if (!incomingRequest) return;
      try {
          // Encode the current full state to send to the new guest
          const stateVector = Y.encodeStateAsUpdate(ydoc);
          // Send as Array<number>
          await invoke("approve_join", { 
            peerId: incomingRequest, 
            content: Array.from(stateVector) 
          });
          
          setIncomingRequest(null);
          setStatus(`Accepted ${incomingRequest.slice(0,8)}`);
      } catch (e) {
          setStatus(`Error accepting: ${e}`);
      }
  }

  return (
    <main className="container">
      <h1>P2P Editor {isHost ? "(Host)" : "(Guest)"}</h1>
      
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

      {incomingRequest && (
          <div style={{ background: "#313244", padding: "1rem", margin: "1rem", borderRadius: "8px", border: "1px solid #89b4fa" }}>
              <p><strong>{incomingRequest.slice(0,8)}...</strong> wants to join.</p>
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