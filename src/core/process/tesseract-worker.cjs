'use strict';

const fetch = global.fetch || require('node-fetch');
const { parentPort } = require('worker_threads');
const { simd } = require('wasm-feature-detect');
const worker = require('tesseract.js/src/worker-script');
const gunzip = require('tesseract.js/src/worker-script/node/gunzip');
const cache = require('tesseract.js/src/worker-script/node/cache');

let TesseractCore = null;

const IGNORABLE_CORE_WARNINGS = [
  /^Warning: Parameter not found:/,
];

function shouldIgnoreCoreWarning(message) {
  return IGNORABLE_CORE_WARNINGS.some((pattern) => pattern.test(String(message || '').trim()));
}

function wrapCoreFactory(CoreFactory) {
  return (options = {}) => CoreFactory({
    ...options,
    printErr(message) {
      if (shouldIgnoreCoreWarning(message)) {
        return;
      }
      if (typeof options.printErr === 'function') {
        options.printErr(message);
        return;
      }
      if (message != null) {
        console.warn(String(message));
      }
    },
  });
}

async function getStableCore(lstmOnly, _corePath, res) {
  if (TesseractCore !== null) {
    return TesseractCore;
  }

  const statusText = 'loading tesseract core';
  res.progress({ status: statusText, progress: 0 });

  const simdSupport = await simd();
  if (simdSupport) {
    TesseractCore = lstmOnly
      ? wrapCoreFactory(require('tesseract.js-core/tesseract-core-simd-lstm'))
      : wrapCoreFactory(require('tesseract.js-core/tesseract-core-simd'));
  } else {
    TesseractCore = lstmOnly
      ? wrapCoreFactory(require('tesseract.js-core/tesseract-core-lstm'))
      : wrapCoreFactory(require('tesseract.js-core/tesseract-core'));
  }

  res.progress({ status: statusText, progress: 1 });
  return TesseractCore;
}

parentPort.on('message', (packet) => {
  worker.dispatchHandlers(packet, (obj) => parentPort.postMessage(obj));
});

worker.setAdapter({
  getCore: getStableCore,
  gunzip,
  fetch,
  ...cache,
});