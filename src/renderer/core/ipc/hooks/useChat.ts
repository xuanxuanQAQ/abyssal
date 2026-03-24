/**
 * useChat — 聊天发送 mutation hook
 *
 * 流式响应的监听由 useChatStore + 组件内 useEffect 管理，
 * 此处仅提供发送消息的 mutation。
 */

import { useMutation } from '@tanstack/react-query';
import { getAPI } from '../bridge';
import type { ChatContext } from '../../../../shared-types/ipc';
import { handleError } from '../../errors/errorHandlers';

export function useSendChatMessage() {
  return useMutation({
    mutationFn: ({
      message,
      context,
    }: {
      message: string;
      context?: ChatContext;
    }) => getAPI().chat.send(message, context),

    onError: (err) => handleError(err),
  });
}
