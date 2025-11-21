import { EditorContent } from "@tiptap/react";
import { useCollaborativeEditor } from "./hooks/useCollaborativeEditor";
import { useP2P } from "./hooks/useP2P";
import { PeerList } from "./components/PeerList";
import { IncomingRequest } from "./components/IncomingRequest";
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

  return (
    <main className="container">
      <h1>P2P Editor {isHost ? "(Host)" : "(Guest)"}</h1>
      
      <PeerList peers={peers} onJoin={sendJoinRequest} />

      {incomingRequest && (
        <IncomingRequest 
          peerId={incomingRequest} 
          onAccept={acceptRequest} 
          onReject={rejectRequest} 
        />
      )}

      <div className="editor-wrapper">
        <EditorContent editor={editor} />
      </div>
      
      <p className="status-bar">{status}</p>
    </main>
  );
}

export default App;