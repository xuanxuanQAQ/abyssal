/**
 * Electron main process entry point.
 *
 * - Creates BrowserWindow for the renderer (React UI)
 * - Registers IPC handlers bridging renderer ↔ core modules
 * - In --batch mode: runs Orchestrator headlessly and exits
 */
