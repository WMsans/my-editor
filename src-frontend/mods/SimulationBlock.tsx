// src-frontend/mods/SimulationBlock.tsx
import { NodeViewWrapper } from "@tiptap/react";
import React, { useEffect, useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { registry } from "../mod-engine/Registry";

// 1. The React Component
const SimulationComponent = (props: any) => {
  // Use default if code is null
  const defaultCode = "// Draw something cool\nconst ctx = canvas.getContext('2d');\nctx.fillStyle = 'red';\nctx.fillRect(10, 10, 50, 50);";
  
  const [code, setCode] = useState(props.node.attrs.code || defaultCode);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync from Tiptap attributes (Collaboration/Peers) to local state
  useEffect(() => {
    const currentAttr = props.node.attrs.code;
    // If attribute is not null (modified) and different from local state, update local state
    if (currentAttr !== null && currentAttr !== code) {
      setCode(currentAttr);
    }
  }, [props.node.attrs.code, code]);

  // Handle typing: Update local state AND Tiptap attributes
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value;
    setCode(newCode);
    props.updateAttributes({ code: newCode });
  };

  const runCode = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    // Clear canvas
    canvas.width = canvas.width; 
    
    try {
      // DANGER: Eval is used for "Turing Completeness". 
      // In a real app, use a sandboxed iframe or QuickJS-wasm.
      const func = new Function("canvas", "console", code);
      func(canvas, { log: console.log });
      setError(null);
      // Ensure attributes are consistent (though handleChange handles it mostly)
      props.updateAttributes({ code });
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <NodeViewWrapper className="simulation-block">
      <div className="block-header" contentEditable={false}>
        <span className="block-type">🖥️ Simulation Node</span>
        <button onClick={runCode}>▶ Run</button>
      </div>
      <div className="simulation-content" contentEditable={false}>
        <textarea 
          value={code} 
          onChange={handleChange}
          spellCheck={false}
          onKeyDown={(e) => e.stopPropagation()} // Prevent editor shortcuts
        />
        <div className="canvas-wrapper">
           <canvas ref={canvasRef} width={300} height={200} />
           {error && <div className="error-log">{error}</div>}
        </div>
      </div>
    </NodeViewWrapper>
  );
};

// 2. The Tiptap Node Definition
export const SimulationNode = Node.create({
  name: 'simulationBlock',
  group: 'block',
  atom: true, // It's a single unit, not a text container

  addAttributes() {
    return {
      code: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'simulation-block' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['simulation-block', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SimulationComponent);
  },
});

// 3. Register the Mod
registry.register({
  id: "simulation",
  name: "Simulation Container",
  description: "A Turing-complete JS sandbox",
  extension: SimulationNode,
  component: SimulationComponent
});