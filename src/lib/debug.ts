// A simple logger that can be expanded later
// For now, it just logs to the console.

export const debugLog = {
  log: (...args: any[]) => {
    console.log('[LOG]', ...args);
  },
  error: (...args: any[]) => {
    console.error('[ERROR]', ...args);
  },
  warn: (...args: any[]) => {
    console.warn('[WARN]', ...args);
  },
}; 