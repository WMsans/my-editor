// src-frontend/components/SlashMenu.tsx
import React, { useEffect, useState } from "react";
import { Editor } from "@tiptap/react";
import { registry } from "../mod-engine/Registry";

interface SlashMenuProps {
  editor: Editor;
}

export const SlashMenu: React.FC<SlashMenuProps> = ({ editor }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const items = registry.getAll();

  useEffect(() => {
    const handleUpdate = () => {
      const { state, view } = editor;
      const { selection } = state;
      const { $from } = selection;
      
      // Detect "/" at start of a paragraph OR after a hard break
      const parent = $from.parent;
      
      // We use \uFFFC (Object Replacement Character) as the placeholder for leaf nodes like HardBreak
      const textBefore = parent.textBetween(0, $from.parentOffset, '\n', '\uFFFC');
      
      // Check if line starts with "/" 
      // 1. "/" at very start
      // 2. "\n/" after a block node (if any)
      // 3. "\uFFFC/" after a HardBreak node
      const isStartOfLine = textBefore === "/" || textBefore.endsWith("\n/") || textBefore.endsWith("\uFFFC/");

      if (isStartOfLine && parent.type.name === 'paragraph') {
        const coords = view.coordsAtPos($from.pos);
        const editorRect = view.dom.getBoundingClientRect();
        
        setIsOpen(true);
        setPosition({
          top: coords.top - editorRect.top + 30, 
          left: coords.left - editorRect.left
        });
      } else {
        setIsOpen(false);
      }
    };

    editor.on("transaction", handleUpdate);
    return () => { editor.off("transaction", handleUpdate); };
  }, [editor]);

  const executeCommand = (modId: string) => {
    // Delete the "/"
    editor.commands.deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from });
    
    if (modId === 'simulation') {
      editor.commands.insertContent({ type: 'simulationBlock' });
    }
    
    setIsOpen(false);
    editor.chain().focus().run();
  };

  if (!isOpen) return null;

  return (
    <div 
      className="slash-menu"
      style={{ top: position.top, left: position.left, position: 'absolute' }}
    >
      <div className="slash-header">Add Block</div>
      {items.map((mod, index) => (
        <button
          key={mod.id}
          className={`slash-item ${index === selectedIndex ? 'selected' : ''}`}
          onClick={() => executeCommand(mod.id)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <strong>{mod.name}</strong>
          <small>{mod.description}</small>
        </button>
      ))}
    </div>
  );
};