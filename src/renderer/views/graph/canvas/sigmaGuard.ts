/**
 * sigmaGuard — Safe wrapper for Sigma operations that may fail
 * when the WebGL context is lost (e.g., after display:none, GPU reset).
 */
import type Sigma from 'sigma';

/**
 * Safely call sigma.refresh(), swallowing WebGL context-loss errors.
 * Returns true if refresh succeeded, false if the context was lost.
 */
export function safeSigmaRefresh(sigma: Sigma | null | undefined): boolean {
  if (!sigma) return false;
  try {
    sigma.refresh();
    return true;
  } catch {
    // WebGL context lost — cannot render. The context-restored handler
    // in useSigmaInstance will recreate the instance when the context returns.
    return false;
  }
}
