import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const MarkdownLivePreview = Extension.create({
  name: "markdownLivePreview",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("markdown-live-preview"),
        props: {
          decorations(state) {
            const { doc, selection } = state;
            const decorations: Decoration[] = [];

            doc.descendants((node, pos) => {
              if (!node.isText) return;

              const text = node.text;
              if (!text) return;

              // --- 1. Handle Bold (**text**) ---
              const boldRegex = /\*\*([^*]+)\*\*/g;
              let match;
              while ((match = boldRegex.exec(text)) !== null) {
                const start = pos + match.index;
                const end = start + match[0].length;
                const innerStart = start + 2;
                const innerEnd = end - 2;

                // Check if cursor is touching this range
                const isCursorInside =
                  selection.from >= start && selection.to <= end;

                // Always bold the inner text
                decorations.push(
                  Decoration.inline(innerStart, innerEnd, {
                    class: "md-bold-preview",
                  })
                );

                // If cursor is NOT inside, hide the syntax markers
                if (!isCursorInside) {
                  decorations.push(
                    Decoration.inline(start, innerStart, {
                      class: "md-syntax-hidden",
                    }),
                    Decoration.inline(innerEnd, end, {
                      class: "md-syntax-hidden",
                    })
                  );
                }
              }

              // --- 2. Handle Headings (## text) ---
              // Note: This simple regex assumes the heading is in its own text block.
              // For robust headings, we usually check the parent node, but this works for visual preview.
              const headingRegex = /^(#{1,6})\s(.+)$/g;
              while ((match = headingRegex.exec(text)) !== null) {
                const start = pos + match.index;
                const end = start + match[0].length;
                const hashLen = match[1].length;
                // The space after hashes
                const syntaxEnd = start + hashLen + 1; 

                const isCursorInside =
                    selection.from >= start && selection.to <= end;

                // Apply heading size to the whole line
                decorations.push(
                  Decoration.inline(start, end, {
                    class: `md-heading-preview h${hashLen}`,
                  })
                );

                if (!isCursorInside) {
                    // Hide the "# " part
                    decorations.push(
                        Decoration.inline(start, syntaxEnd, { class: "md-syntax-hidden" })
                    );
                }
              }
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});