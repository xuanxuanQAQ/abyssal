/**
 * useProjectSetup — 检测是否需要显示项目向导
 *
 * 如果没有任何已有项目，自动显示向导。
 */

import { useState, useEffect } from 'react';
import { getAPI } from '../../core/ipc/bridge';
import { isShutdownError } from '../../core/errors/types';

export function useProjectSetup() {
  const [showWizard, setShowWizard] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAPI()
      .app.listProjects()
      .then((projects) => {
        if (!cancelled && projects.length === 0) {
          setShowWizard(true);
        }
        setChecked(true);
      })
      .catch((err: unknown) => {
        if (!isShutdownError(err)) console.warn('[ProjectSetup] Failed to check projects:', err);
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    showWizard,
    setShowWizard,
    checked,
  };
}
