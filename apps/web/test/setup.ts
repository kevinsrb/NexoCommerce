import '@testing-library/jest-dom';

if (typeof globalThis.crypto.randomUUID !== 'function') {
  let sequence = 0;
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    writable: true,
    value: () => `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}`,
  });
}
