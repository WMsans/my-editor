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
  const items = registry.getAllSlashCommands();

  useEffect(() => {
    const handleUpdate = () => {
      const { state, view } = editor;
      const { selection } = state;
      const { $from } = selection;
      
      // Detect "/" at start of a paragraph
      const parent = $from.parent;
      const textBefore = parent.textBetween(0, $from.parentOffset, '\n', '\uFFFC');
      
      if (textBefore === "/" && parent.type.name === 'paragraph') {
        const coords = view.coordsAtPos($from.pos);
        // Adjust for editor offset
        const editorRect = view.dom.getBoundingClientRect();
        
        setIsOpen(true);
        setPosition({
          top: coords.top - editorRect.top + 30, // Relative to editor container
          left: coords.left - editorRect.left
        });
      } else {
        setIsOpen(false);
      }
    };

    editor.on("transaction", handleUpdate);
    return () => { editor.off("transaction", handleUpdate); };
  }, [editor]);

  const executeCommand = (cmdDef: any) => {
    // Pass the range of the trigger character ("/") to the command.
    const range = { 
        from: editor.state.selection.from - 1, 
        to: editor.state.selection.from 
    };
    
    // Execute the command via registry dynamically
    // The command handler (worker or main) is responsible for replacing this range.
    registry.executeCommand(cmdDef.command, { range });
    
    setIsOpen(false);
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
          key={mod.id + mod.command} // Use composite key
          className={`slash-item ${index === selectedIndex ? 'selected' : ''}`}
          onClick={() => executeCommand(mod)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <strong>{mod.title}</strong>
          <small>{mod.description}</small>
        </button>
      ))}
    </div>
  );
};