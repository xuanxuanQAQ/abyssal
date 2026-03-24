/**
 * ExternalFileDrop — 外部文件拖入处理器（§11）
 *
 * HTML5 DnD API：蓝色虚线边框反馈 → 按扩展名分类 → fs:importFiles。
 */

import React, { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { getAPI } from '../../../core/ipc/bridge';
import { useQueryClient } from '@tanstack/react-query';

interface ExternalFileDropProps {
  children: React.ReactNode;
}

const SUPPORTED_EXTS = ['.bib', '.ris', '.pdf'];

export function ExternalFileDrop({ children }: ExternalFileDropProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const queryClient = useQueryClient();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // 只在有文件时显示反馈
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 只在离开容器本身时关闭（忽略子元素边界跨越）
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      // 按扩展名过滤
      const supported = files.filter((f) => {
        const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'));
        return SUPPORTED_EXTS.includes(ext);
      });

      const unsupported = files.length - supported.length;
      if (unsupported > 0) {
        toast.error(`${unsupported} 个文件格式不支持，已跳过`);
      }

      if (supported.length === 0) return;

      try {
        const paths = supported.map((f) => (f as File & { path: string }).path);
        const result = await getAPI().fs.importFiles(paths);
        queryClient.invalidateQueries({ queryKey: ['papers'] });
        toast.success(
          `导入了 ${result.imported} 篇论文 (来自 ${supported.length} 个文件)`
        );
      } catch {
        toast.error('导入失败');
      }
    },
    [queryClient]
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        position: 'relative',
        height: '100%',
      }}
    >
      {children}

      {/* 拖拽反馈遮罩 */}
      {isDragOver && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            border: '2px dashed var(--accent-color)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'rgba(59, 130, 246, 0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--bg-surface)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              fontSize: 'var(--text-md)',
              fontWeight: 500,
            }}
          >
            释放以导入文献
          </span>
        </div>
      )}
    </div>
  );
}
