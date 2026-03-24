/**
 * React 渲染进程入口
 *
 * 挂载 App 根组件到 DOM。
 */

import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/global.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in document');
}

const root = createRoot(rootEl);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
