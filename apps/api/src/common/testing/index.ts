export interface ProviderObject {
  provide: any;
  useValue?: any;
  useClass?: any;
}

export type Provider = any | ProviderObject;

export interface ModuleMetadata {
  providers?: Provider[];
}

export class TestingModule {
  private readonly providerMap = new Map<any, any>();

  constructor(providers: Provider[] = []) {
    for (const provider of providers) {
      if (provider && typeof provider === 'object' && 'provide' in provider) {
        this.providerMap.set(provider.provide, provider.useValue ?? provider.useClass);
      } else if (typeof provider === 'function') {
        this.providerMap.set(provider, provider);
      }
    }
  }

  get<T = any>(token: any): T {
    const found = this.providerMap.get(token);
    if (found !== undefined) {
      // If it's a class registered directly and not yet an instance
      if (typeof found === 'function' && found.prototype && !(found instanceof found)) {
        return found;
      }
      return found;
    }
    return undefined as unknown as T;
  }
}

export class Test {
  static createTestingModule(metadata: ModuleMetadata) {
    return {
      compile: async (): Promise<TestingModule> => {
        const module = new TestingModule(metadata.providers);
        // If a service class is provided without useValue, instantiate it with mapped dependencies
        for (const provider of metadata.providers ?? []) {
          if (typeof provider === 'function' && provider.prototype) {
            // Find dependencies from other providers
            const deps = (metadata.providers ?? [])
              .filter((p): p is ProviderObject => typeof p === 'object' && p !== null && 'useValue' in p)
              .map((p) => p.useValue);
            try {
              const instance = new provider(...deps);
              (module as any).providerMap.set(provider, instance);
            } catch {
              // fallback
            }
          }
        }
        return module;
      },
    };
  }
}
