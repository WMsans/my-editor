import React, { useState, useEffect, useRef } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";

// --- 1. The Component (UI) ---
const ImageComponent = (props: any) => {
  const [src, setSrc] = useState(props.node.attrs.src);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Access the HostAPI via the closure context or window (since we are in main thread)
  // For robustness in this transpiled env, we'll assume context was passed to activate
  // but here we are in a React Component. We can access the global exposed API.
  const api = (window as any).CollabAPI;

  // Sync with remote changes
  useEffect(() => {
    if (props.node.attrs.src !== src) {
      setSrc(props.node.attrs.src);
    }
  }, [props.node.attrs.src]);

  // Load Image Data
  useEffect(() => {
    let active = true;
    if (!src) {
        setImageUrl(null);
        return;
    }

    const loadImage = async () => {
        if(!api) return;
        setLoading(true);
        setError(null);
        try {
            // Read bytes from the host filesystem (resolves relative path automatically now)
            const bytes: number[] = await api.data.fs.readFile(src);
            if (!active) return;
            
            // Create Blob URL
            const u8 = new Uint8Array(bytes);
            const blob = new Blob([u8]); // We let browser sniff mime or default
            const url = URL.createObjectURL(blob);
            setImageUrl(url);
        } catch (e: any) {
            if (active) setError("Failed to load image: " + e.toString());
        } finally {
            if (active) setLoading(false);
        }
    };

    loadImage();
    
    return () => { 
        active = false;
        if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [src]); // Re-run when source path changes

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !api) return;

    if (!file.type.startsWith("image/")) {
        alert("Please select an image file.");
        return;
    }

    setLoading(true);
    try {
        // 1. Read file from browser input
        const buffer = await file.arrayBuffer();
        const data = Array.from(new Uint8Array(buffer));

        // 2. Ensure resources/textures exists
        // We attempt to create it. If it exists or backend fails efficiently, we proceed.
        try {
            await api.data.fs.createDirectory("resources");
            await api.data.fs.createDirectory("resources/textures");
        } catch (err) {
            // Ignore error if folder likely exists
            console.log("Folder creation result:", err);
        }

        // 3. Write file
        const relPath = `resources/textures/${file.name}`;
        await api.data.fs.writeFile(relPath, data);

        // 4. Update Node
        props.updateAttributes({ src: relPath });
        setSrc(relPath); // Optimistic update
    } catch (e: any) {
        setError("Upload failed: " + e.toString());
    } finally {
        setLoading(false);
        // Reset input
        if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <NodeViewWrapper className="image-block" style={{ margin: '1rem 0' }}>
      <div className="image-content" contentEditable={false} style={{
          background: '#181825',
          border: '1px solid #45475a',
          borderRadius: '6px',
          padding: '10px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          minHeight: '100px',
          position: 'relative'
      }}>
        {loading && <div style={{ color: '#89b4fa', marginBottom: '10px' }}>Loading...</div>}
        
        {imageUrl ? (
             <img 
                src={imageUrl} 
                alt="content" 
                style={{ maxWidth: '100%', maxHeight: '500px', borderRadius: '4px' }}
             />
        ) : (
            !loading && <div style={{ color: '#585b70', padding: '20px' }}>No image selected</div>
        )}

        {error && <div style={{ color: '#f38ba8', fontSize: '0.8rem', marginTop: '10px' }}>{error}</div>}

        <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: '#a6adc8' }}>
                {src || "Unsaved"}
            </span>
            <button 
                onClick={handleUploadClick}
                style={{
                    background: '#313244', border: '1px solid #585b70',
                    color: '#cdd6f4', padding: '4px 8px', borderRadius: '4px',
                    cursor: 'pointer', fontSize: '0.85rem'
                }}
            >
                {src ? "Change Image" : "Select Image"}
            </button>
        </div>

        {/* Invisible Input */}
        <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            accept="image/*"
            onChange={handleFileChange}
        />
      </div>
    </NodeViewWrapper>
  );
};

// --- 2. Tiptap Node Definition ---
const ImageNode = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'image-block' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['image-block', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageComponent);
  },
});

// --- 3. Activation ---
export function activate(context: any) {
  context.editor.registerExtension(ImageNode);

  context.commands.registerCommand("image.insert", () => {
    const editor = context.editor.getSafeInstance();
    if (editor) {
      editor.chain().focus().insertContent({ type: 'imageBlock' }).run();
    }
  });
}

export function deactivate() {}