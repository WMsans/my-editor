import React, { useEffect, useRef, useState } from "react"; // Provided by Host
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react"; // Provided by Host
import { Node, mergeAttributes } from "@tiptap/core"; // Provided by Host

// --- 1. The Component (Logic) ---
const SimulationComponent = (props: any) => {
  const defaultCode = "// Draw something cool\nconst ctx = canvas.getContext('2d');\nctx.fillStyle = 'red';\nctx.fillRect(10, 10, 50, 50);";
  
  const [code, setCode] = useState(props.node.attrs.code || defaultCode);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const currentAttr = props.node.attrs.code;
    if (currentAttr !== null && currentAttr !== code) {
      setCode(currentAttr);
    }
  }, [props.node.attrs.code]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value;
    setCode(newCode);
    props.updateAttributes({ code: newCode });
  };

  const runCode = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = canvas.width; 
    
    try {
      const func = new Function("canvas", "console", code);
      func(canvas, { log: console.log });
      setError(null);
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
          onKeyDown={(e) => e.stopPropagation()} 
        />
        <div className="canvas-wrapper">
           <canvas ref={canvasRef} width={300} height={200} />
           {error && <div className="error-log">{error}</div>}
        </div>
      </div>
    </NodeViewWrapper>
  );
};

// --- 2. The Tiptap Extension Definition ---
const SimulationNode = Node.create({
  name: 'simulationBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      code: { default: null },
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

// --- 3. The Activation Hook (The New Entry Point) ---
// This replaces 'registry.register' calls.
export function activate(context: any) {
  // 1. Register the Editor Extension (The Block)
  context.editor.registerExtension(SimulationNode);

  // 2. Register the Command (Linked to plugin.json "slashMenu")
  context.commands.registerCommand("simulation.insert", () => {
    const editor = context.editor.getSafeInstance();
    if (editor) {
      editor.chain().focus().insertContent({ type: 'simulationBlock' }).run();
    }
  });

  console.log("Simulation Plugin Activated!");
}

export function deactivate() {
  // Optional cleanup
}