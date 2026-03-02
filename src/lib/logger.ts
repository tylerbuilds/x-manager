type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Cache config at module load — env vars don't change during process lifecycle
const _configuredLevel: LogLevel = (() => {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (raw in LEVEL_ORDER) return raw as LogLevel;
  return 'info';
})();

const _isTextFormat: boolean = (process.env.LOG_FORMAT || '').toLowerCase() === 'text';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[_configuredLevel];
}

function extractExtra(args: unknown[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const arg of args) {
    if (arg instanceof Error) {
      data.error = arg.message;
      data.stack = arg.stack;
    } else if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
      Object.assign(data, arg);
    } else if (arg !== undefined) {
      // Primitive extra arg — append to message detail
      data.detail = data.detail ? `${data.detail} ${String(arg)}` : String(arg);
    }
  }
  return data;
}

function emitJson(level: LogLevel, component: string, msg: string, extra: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
    ...extra,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function emitText(level: LogLevel, component: string, msg: string, extra: Record<string, unknown>): void {
  const prefix = `[${component}]`;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (Object.keys(extra).length > 0) {
    const { error: _err, stack: _stack, ...rest } = extra;
    const suffix = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    out(`${prefix} ${msg}${suffix}`);
    if (_stack) out(`${prefix}   ${_stack}`);
  } else {
    out(`${prefix} ${msg}`);
  }
}

function emit(level: LogLevel, component: string, msg: string, extra: Record<string, unknown>): void {
  if (_isTextFormat) {
    emitText(level, component, msg, extra);
  } else {
    emitJson(level, component, msg, extra);
  }
}

export interface Logger {
  debug: (msg: string, ...extra: unknown[]) => void;
  info: (msg: string, ...extra: unknown[]) => void;
  warn: (msg: string, ...extra: unknown[]) => void;
  error: (msg: string, ...extra: unknown[]) => void;
}

export function logger(component: string): Logger {
  return {
    debug(msg: string, ...extra: unknown[]) {
      if (shouldLog('debug')) emit('debug', component, msg, extractExtra(extra));
    },
    info(msg: string, ...extra: unknown[]) {
      if (shouldLog('info')) emit('info', component, msg, extractExtra(extra));
    },
    warn(msg: string, ...extra: unknown[]) {
      if (shouldLog('warn')) emit('warn', component, msg, extractExtra(extra));
    },
    error(msg: string, ...extra: unknown[]) {
      if (shouldLog('error')) emit('error', component, msg, extractExtra(extra));
    },
  };
}
