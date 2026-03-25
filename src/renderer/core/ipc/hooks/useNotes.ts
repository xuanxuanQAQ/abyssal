/**
 * useNotes -- research note query & mutation hooks (v2.0)
 *
 * Query Key: ['notes', filterParams] / ['notes', 'file', noteId]
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { NewNote, NoteFilter, NoteMeta, ConceptDraft } from '../../../../shared-types/models';
import { handleError } from '../../errors/errorHandlers';

export function useNoteList(filter?: NoteFilter) {
  return useQuery({
    queryKey: ['notes', filter ?? {}],
    queryFn: () => getAPI().db.notes.list(filter),
    staleTime: 30_000,
  });
}

export function useNote(noteId: string | null) {
  return useQuery({
    queryKey: ['notes', 'detail', noteId],
    queryFn: () => getAPI().db.notes.get(noteId!),
    enabled: !!noteId,
  });
}

export function useNoteFileContent(noteId: string | null) {
  return useQuery({
    queryKey: ['notes', 'file', noteId],
    queryFn: () => getAPI().fs.readNoteFile(noteId!),
    enabled: !!noteId,
    staleTime: 0,
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (note: NewNote) => getAPI().db.notes.create(note),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useUpdateNoteMeta() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, patch }: { noteId: string; patch: Partial<NoteMeta> }) =>
      getAPI().db.notes.updateMeta(noteId, patch),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteId: string) => getAPI().db.notes.delete(noteId),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useSaveNoteFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, content }: { noteId: string; content: string }) =>
      getAPI().fs.saveNoteFile(noteId, content),

    onSuccess: (_data, { noteId }) => {
      queryClient.invalidateQueries({ queryKey: ['notes', 'file', noteId] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },

    onError: (err) => handleError(err),
  });
}

export function useUpgradeNoteToConcept() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, draft }: { noteId: string; draft: ConceptDraft }) =>
      getAPI().db.notes.upgradeToConcept(noteId, draft),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['concepts'] });
    },

    onError: (err) => handleError(err),
  });
}
