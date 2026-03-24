/**
 * useSectionSwitch -- Section switch flow (section 9.2)
 *
 * 1. Check unsavedChanges -> if true, save current section immediately
 * 2. Wait for save to complete
 * 3. Load new section content (Markdown)
 * 4. Set editor content via editor.commands.setContent
 * 5. Update SectionTitleInput
 * 6. Reset unsavedChanges = false
 * 7. Focus editor start
 */

import { useCallback, useRef } from 'react';
import { useUpdateSection } from '../../../../core/ipc/hooks/useArticles';
import { useEditorStore } from '../../../../core/store/useEditorStore';
import { countWords } from './useWordCount';
import { extractCitedPaperIds } from '../../shared/citationPattern';
import type { Editor } from '@tiptap/react';

// ── Types ──

interface UseSectionSwitchOptions {
  editor: Editor | null;
  currentSectionId: string | null;
  getMarkdown: () => string;
  onTitleLoaded: (title: string) => void;
}

interface UseSectionSwitchReturn {
  switchTo: (newSectionId: string) => Promise<void>;
}

export function useSectionSwitch({
  editor,
  currentSectionId,
  getMarkdown,
  onTitleLoaded,
}: UseSectionSwitchOptions): UseSectionSwitchReturn {
  const { mutateAsync: updateSection } = useUpdateSection();

  // Track current section id in a ref so the async callback always
  // sees the latest value without needing it as a dep.
  const currentSectionIdRef = useRef(currentSectionId);
  currentSectionIdRef.current = currentSectionId;

  // Guard against concurrent switches
  const switchingRef = useRef(false);

  const switchTo = useCallback(
    async (newSectionId: string) => {
      if (switchingRef.current) return;
      if (newSectionId === currentSectionIdRef.current) return;
      if (editor === null) return;

      switchingRef.current = true;

      try {
        // Step 1-2: Save current section if there are unsaved changes
        const oldSectionId = currentSectionIdRef.current;
        if (oldSectionId !== null && useEditorStore.getState().unsavedChanges) {
          const markdown = getMarkdown();
          const citedPaperIds = extractCitedPaperIds(markdown);
          const wordCount = countWords(markdown);

          await updateSection({
            sectionId: oldSectionId,
            patch: {
              content: markdown,
              wordCount,
              citedPaperIds,
            },
          });
        }

        // Step 3: Load new section content
        // We fetch directly via the query client's underlying API call.
        // The useSection hook will refetch reactively once the component
        // re-renders with the new sectionId, but we need the data NOW
        // for step 4. We import getAPI for a direct call.
        const { getAPI } = await import('../../../../core/ipc/bridge');
        const sectionData = await getAPI().db.articles.getSection(newSectionId);

        // Step 4: Set editor content
        editor.commands.setContent(sectionData.content);

        // Step 5: Update SectionTitleInput via callback
        // The title comes from the outline data, but the section's parent
        // outline contains it. We need to fetch from a different source.
        // The caller passes onTitleLoaded to set the title in the input.
        // For now, we pass the section title if available from the outline;
        // the caller can get it from the outline data.
        // Since SectionContent doesn't include the title, the caller is
        // responsible for reading the title from the outline and passing
        // it via onTitleLoaded. We signal that the switch happened.
        // Actually, looking at ArticleOutline / SectionNode, the title lives
        // there. The caller should have access to the outline.
        // We still call onTitleLoaded so the caller can update their state.
        onTitleLoaded(''); // Caller resolves actual title from outline

        // Step 6: Reset unsavedChanges
        useEditorStore.getState().setUnsavedChanges(false);

        // Step 7: Focus editor and move cursor to start
        editor.commands.focus('start');
      } finally {
        switchingRef.current = false;
      }
    },
    [editor, getMarkdown, onTitleLoaded, updateSection],
  );

  return { switchTo };
}
