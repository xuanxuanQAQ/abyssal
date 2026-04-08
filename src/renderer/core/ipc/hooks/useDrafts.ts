import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type {
  DraftPatch,
  DraftSummary,
  SectionOrder,
  SectionPatch,
} from '../../../../shared-types/models';
import { buildDocumentProjection, parseArticleDocument } from '../../../../shared/writing/documentOutline';
import { handleError } from '../../errors/errorHandlers';
import { useViewActive } from '../../context/ViewActiveContext';

export function useDraftList(articleId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['drafts', articleId],
    queryFn: () => getAPI().db.drafts.listByArticle(articleId!),
    enabled: articleId !== null && viewActive,
    staleTime: 60_000,
    gcTime: 300_000,
  });
}

export function useDraftOutline(draftId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['drafts', 'outline', draftId],
    queryFn: () => getAPI().db.drafts.getOutline(draftId!),
    enabled: draftId !== null && viewActive,
    staleTime: 0,
    gcTime: 300_000,
  });
}

export function useDraftSectionContent(draftId: string | null, sectionId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['drafts', 'section', draftId, sectionId],
    enabled: draftId !== null && sectionId !== null && viewActive,
    staleTime: 0,
    gcTime: 300_000,
    queryFn: async () => {
      const payload = await getAPI().db.drafts.getDocument(draftId!);
      const projection = buildDocumentProjection(parseArticleDocument(payload.documentJson));
      const section = projection.flatSections.find((candidate) => candidate.id === sectionId);
      return {
        content: section?.plainText ?? '',
        documentJson: section?.bodyDocument ? JSON.stringify(section.bodyDocument) : null,
      };
    },
  });
}

export function useDraftVersions(draftId: string | null) {
  const viewActive = useViewActive();
  return useQuery({
    queryKey: ['drafts', 'versions', draftId],
    queryFn: () => getAPI().db.drafts.getVersions(draftId!),
    enabled: draftId !== null && viewActive,
    staleTime: 30_000,
    gcTime: 300_000,
  });
}

export function useCreateDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ articleId, seed }: { articleId: string; seed?: Partial<DraftPatch> & { title?: string; basedOnDraftId?: string | null; source?: DraftSummary['source'] } }) => (
      getAPI().db.drafts.create(articleId, seed)
    ),
    onSuccess: (draft, { articleId }) => {
      queryClient.invalidateQueries({ queryKey: ['drafts', articleId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', 'outline', draft.id] });
      queryClient.invalidateQueries({ queryKey: ['articles', 'outlines'] });
    },
    onError: (err) => handleError(err),
  });
}

export function useUpdateDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, patch }: { draftId: string; patch: DraftPatch }) => getAPI().db.drafts.update(draftId, patch),
    onSuccess: (_data, { draftId }) => {
      queryClient.invalidateQueries({ queryKey: ['drafts', 'outline', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', 'versions', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
    },
    onError: (err) => handleError(err),
  });
}

export function useDeleteDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draftId: string) => getAPI().db.drafts.delete(draftId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['articles', 'outlines'] });
    },
    onError: (err) => handleError(err),
  });
}

export function useUpdateDraftOutlineOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, order }: { draftId: string; order: SectionOrder[] }) => getAPI().db.drafts.updateOutlineOrder(draftId, order),
    onSuccess: (_data, { draftId }) => {
      queryClient.invalidateQueries({ queryKey: ['drafts', 'outline', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', 'versions', draftId] });
    },
    onError: (err) => handleError(err),
  });
}

export function useUpdateDraftSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, sectionId, patch }: { draftId: string; sectionId: string; patch: SectionPatch }) => (
      getAPI().db.drafts.updateSection(draftId, sectionId, patch)
    ),
    onSuccess: (_data, { draftId, sectionId }) => {
      queryClient.invalidateQueries({ queryKey: ['drafts', 'section', draftId, sectionId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', 'outline', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', 'versions', draftId] });
    },
    onError: (err) => handleError(err),
  });
}

export function useCreateDraftSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, parentId, sortIndex, title }: { draftId: string; parentId: string | null; sortIndex: number; title?: string | undefined }) => (
      getAPI().db.drafts.createSection(draftId, parentId, sortIndex, title)
    ),
    onSuccess: (_data, { draftId }) => {
      queryClient.invalidateQueries({ queryKey: ['drafts', 'outline', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', 'versions', draftId] });
    },
    onError: (err) => handleError(err),
  });
}

export function useDeleteDraftSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, sectionId }: { draftId: string; sectionId: string }) => getAPI().db.drafts.deleteSection(draftId, sectionId),
    onSuccess: (_data, { draftId, sectionId }) => {
      queryClient.invalidateQueries({ queryKey: ['drafts', 'section', draftId, sectionId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', 'outline', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', 'versions', draftId] });
    },
    onError: (err) => handleError(err),
  });
}

export function useRestoreDraftVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, version }: { draftId: string; version: number }) => getAPI().db.drafts.restoreVersion(draftId, version),
    onSuccess: (_data, { draftId }) => {
      queryClient.invalidateQueries({ queryKey: ['drafts', 'outline', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', 'versions', draftId] });
      queryClient.invalidateQueries({ queryKey: ['drafts', 'section', draftId] });
    },
    onError: (err) => handleError(err),
  });
}