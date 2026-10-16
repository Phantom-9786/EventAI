export interface LoggerService {
  log(message: any, ...optionalParams: any[]): any;
  error(message: any, ...optionalParams: any[]): any;
  warn(message: any, ...optionalParams: any[]): any;
  debug?(message: any, ...optionalParams: any[]): any;
  verbose?(message: any, ...optionalParams: any[]): any;
}

export class ConsoleLogger implements LoggerService {
  public context?: string;

  constructor(context?: string) {
    this.context = context;
  }

  log(message: unknown, context?: string): void {
    const ctx = context ?? this.context;
    const prefix = ctx ? `[${ctx}] ` : '';
    process.stdout.write(`${prefix}${String(message)}\n`);
  }

  error(message: unknown, trace?: string, context?: string): void {
    const ctx = context ?? this.context;
    const prefix = ctx ? `[${ctx}] ` : '';
    const traceStr = trace ? `\n${trace}` : '';
    process.stderr.write(`${prefix}${String(message)}${traceStr}\n`);
  }

  warn(message: unknown, context?: string): void {
    const ctx = context ?? this.context;
    const prefix = ctx ? `[${ctx}] ` : '';
    process.stdout.write(`${prefix}${String(message)}\n`);
  }

  debug(message: unknown, context?: string): void {
    const ctx = context ?? this.context;
    const prefix = ctx ? `[${ctx}] ` : '';
    process.stdout.write(`${prefix}${String(message)}\n`);
  }

  verbose(message: unknown, context?: string): void {
    const ctx = context ?? this.context;
    const prefix = ctx ? `[${ctx}] ` : '';
    process.stdout.write(`${prefix}${String(message)}\n`);
  }
}

// ═══════════════════════════════════════════════════
// Structured logging — single-line JSON output when
// enabled (LOG_FORMAT=json or NODE_ENV=production),
// human-readable Nest-style output otherwise.
// ═══════════════════════════════════════════════════

export type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

export function isJsonLogging(env: {
  LOG_FORMAT?: string;
  NODE_ENV?: string;
}): boolean {
  const format = env.LOG_FORMAT?.toLowerCase();
  if (format === 'json') return true;
  if (format === 'text') return false;
  return env.NODE_ENV === 'production';
}

export interface LogMeta {
  [key: string]: unknown;
}

export class StructuredLogger implements LoggerService {
  private readonly jsonMode: boolean;
  private readonly textLogger: ConsoleLogger;

  constructor(
    context: string,
    jsonMode: boolean,
  ) {
    this.jsonMode = jsonMode;
    this.textLogger = new ConsoleLogger(context);
  }

  log(message: unknown, context?: string): void {
    this.emit('log', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.emit('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.emit('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.emit('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.emit('verbose', message, context);
  }

  logWithMeta(level: LogLevel, message: string, meta: LogMeta): void {
    if (!this.jsonMode) {
      const extras = Object.entries(meta)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ');
      this.textLogger[level === 'log' ? 'log' : level](`${message} ${extras}`.trimEnd());
      return;
    }
    this.writeJson(level, message, undefined, meta);
  }

  private emit(level: LogLevel, message: unknown, context?: string, trace?: string): void {
    if (!this.jsonMode) {
      if (level === 'error') {
        this.textLogger.error(message, trace, context);
      } else {
        this.textLogger[level](message, context);
      }
      return;
    }
    this.writeJson(level, message, trace);
  }

  private writeJson(level: LogLevel, message: unknown, trace?: string, meta?: LogMeta): void {
    const entry: Record<string, unknown> = { ...(meta ?? {}) };
    if (this.textLogger['context']) {
      entry.context = this.textLogger['context'];
    }
    if (trace) {
      entry.stack = trace;
    }
    // Reserved fields always win over meta
    entry.timestamp = new Date().toISOString();
    entry.level = level === 'log' ? 'info' : level;
    entry.message = message;
    // Single line so log shippers can parse each entry independently
    const line = JSON.stringify(entry);
    if (level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }
}
