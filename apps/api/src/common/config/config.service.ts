export class ConfigService {
  constructor(private readonly internalEnv: Record<string, unknown> = {}) {}

  get<T = unknown>(key: string, defaultValue?: T): T {
    const val = this.internalEnv[key] ?? process.env[key];
    if (val === undefined || val === null || val === '') {
      return defaultValue as T;
    }
    return val as T;
  }
}
