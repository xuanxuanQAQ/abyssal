/**
 * useNotes -- research note query & mutation hooks (v2.0)
 *
 * Query Key: ['notes', filterParams] / ['notes', 'content', noteId]
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { NewNote, NoteFilter, NoteMeta, ConceptDraft } from '../../../../shared-types/models';
import { handleError } from '../../errors/errorHandlers';
import { useViewActive } from '../../context/ViewActiveContext';

export function useNoteList(filter?: NoteFilter) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['notes', filter ?? {}],
    queryFn: () => getAPI().db.notes.list(filter),
    staleTime: 30_000,
    enabled: viewActive,
  });
}

export function useNote(noteId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['notes', 'detail', noteId],
    queryFn: () => getAPI().db.notes.get(noteId!),
    enabled: !!noteId && viewActive,
  });
}

export function useNoteContent(noteId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['notes', 'content', noteId],
    queryFn: () => getAPI().db.notes.getContent(noteId!),
    enabled: !!noteId && viewActive,
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

export function useSaveNoteContent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, documentJson }: { noteId: string; documentJson: string }) =>
      getAPI().db.notes.saveContent(noteId, documentJson),

    onSuccess: (_data, { noteId }) => {
      queryClient.invalidateQueries({ queryKey: ['notes', 'content', noteId] });
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
