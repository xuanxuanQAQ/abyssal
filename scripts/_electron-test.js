// 最小化 Electron 测试
try {
  const electron = require('electron');
  console.log('electron type:', typeof electron);
  console.log('electron keys:', Object.keys(electron).slice(0, 10));

  // Electron 41 可能改了导出方式
  const app = electron.app || electron.default?.app;
  const BrowserWindow = electron.BrowserWindow || electron.default?.BrowserWindow;

  console.log('app:', typeof app);
  console.log('BrowserWindow:', typeof BrowserWindow);

  if (app && app.whenReady) {
    app.whenReady().then(() => {
      console.log('✅ Electron ready!');
      app.quit();
    });
  } else {
    console.log('❌ app.whenReady not available');
    process.exit(1);
  }
} catch (e) {
  console.log('Error:', e.message);
  process.exit(1);
}
