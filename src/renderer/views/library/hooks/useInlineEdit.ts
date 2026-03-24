/**
 * useInlineEdit — v1.1 通用内联编辑 Hook（§7.3）
 *
 * 管理编辑态、值缓冲。
 * isCanceling useRef 标志位解决 Escape/blur 竞态。
 *
 * Enter → 保存
 * Escape → 设置 isCanceling → blur → 不保存
 * blur → 检查 isCanceling → 若非取消则保存
 * Tab → 保存 + onTabNext 回调
 */

import { useState, useRef, useCallback } from 'react';

interface UseInlineEditOptions {
  initialValue: string;
  onSave: (value: string) => void;
  onCancel?: () => void;
  onTabNext?: () => void;
}

export function useInlineEdit({
  initialValue,
  onSave,
  onCancel,
  onTabNext,
}: UseInlineEditOptions) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(initialValue);
  const isCanceling = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = useCallback(() => {
    setEditValue(initialValue);
    setIsEditing(true);
    isCanceling.current = false;
    // auto-focus handled by caller via inputRef
  }, [initialValue]);

  const commitSave = useCallback(() => {
    setIsEditing(false);
    if (editValue !== initialValue) {
      onSave(editValue);
    }
  }, [editValue, initialValue, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        isCanceling.current = true;
        setIsEditing(false);
        onCancel?.();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitSave();
        onTabNext?.();
      }
    },
    [commitSave, onCancel, onTabNext]
  );

  const handleBlur = useCallback(() => {
    if (isCanceling.current) {
      isCanceling.current = false;
      return;
    }
    commitSave();
  }, [commitSave]);

  return {
    isEditing,
    editValue,
    setEditValue,
    startEdit,
    handleKeyDown,
    handleBlur,
    inputRef,
  };
}
