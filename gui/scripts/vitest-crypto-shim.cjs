const crypto = require('node:crypto');

if (crypto?.webcrypto && typeof crypto.webcrypto.getRandomValues === 'function') {
  globalThis.crypto = globalThis.crypto || crypto.webcrypto;

  if (typeof globalThis.crypto.getRandomValues !== 'function') {
    globalThis.crypto.getRandomValues = crypto.webcrypto.getRandomValues.bind(crypto.webcrypto);
  }

  if (typeof crypto.getRandomValues !== 'function') {
    crypto.getRandomValues = crypto.webcrypto.getRandomValues.bind(crypto.webcrypto);
  }
}
