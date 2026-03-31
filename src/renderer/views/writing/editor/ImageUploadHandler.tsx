/**
 * ImageUploadHandler — Handles image upload and insertion into the Tiptap editor.
 *
 * Uses Electron's native dialog (via IPC) to select an image file,
 * uploads it to workspace assets, and inserts a `figure` node.
 */

import { useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { getAPI } from '../../../core/ipc/bridge';

interface UseImageUploadOptions {
  editor: Editor | null;
  articleId: string | null;
}

export function useImageUpload({ editor, articleId }: UseImageUploadOptions) {
  const uploadAndInsert = useCallback(async () => {
    if (!editor || !articleId) return;

    try {
      const api = getAPI() as any;

      // Use Electron native dialog via IPC to get the file path
      // This works regardless of contextIsolation setting
      let filePath: string | null = null;
      let fileName: string;

      if (typeof api.fs?.selectImageFile === 'function') {
        // Preferred: use IPC-based file dialog
        const result = await api.fs.selectImageFile();
        if (!result) return; // user cancelled
        filePath = result.path;
        fileName = result.name;
      } else {
        // Fallback: use browser File API with Electron's File.path extension
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = false;

        const file = await new Promise<File | null>((resolve) => {
          input.onchange = () => resolve(input.files?.[0] ?? null);
          // Handle cancel by listening for focus return
          const onFocus = () => {
            window.removeEventListener('focus', onFocus);
            setTimeout(() => {
              if (!input.files?.length) resolve(null);
            }, 300);
          };
          window.addEventListener('focus', onFocus);
          input.click();
        });

        if (!file) return;

        filePath = (file as any).path as string | undefined ?? null;
        fileName = file.name;

        if (!filePath) {
          console.error('Cannot get file path — contextIsolation may be blocking File.path');
          return;
        }
      }

      const asset = await api.db.assets.upload(articleId, fileName!, filePath);

      // Insert figure node at current cursor position
      const figureNodeType = editor.schema.nodes.figure;
      if (figureNodeType) {
        editor.chain().focus().command(({ tr, dispatch }) => {
          if (dispatch) {
            const node = figureNodeType.create({
              src: asset.filePath,
              alt: fileName,
              caption: '',
              assetId: asset.id,
              label: '',
              width: null,
            });
            tr.replaceSelectionWith(node);
          }
          return true;
        }).run();
      }
    } catch (err) {
      console.error('Image upload failed:', err);
    }
  }, [editor, articleId]);

  return { uploadAndInsert };
}
