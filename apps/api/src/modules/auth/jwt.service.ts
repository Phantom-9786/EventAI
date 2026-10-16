import jwt, { type SignOptions } from 'jsonwebtoken';

export interface JwtModuleOptions {
  secret: string;
  signOptions?: SignOptions;
}

export class JwtService {
  constructor(private readonly options: JwtModuleOptions = { secret: '' }) {}

  async signAsync(payload: string | Buffer | object, options?: SignOptions): Promise<string> {
    const combinedOptions: SignOptions = {
      ...(this.options.signOptions ?? {}),
      ...(options ?? {}),
    };
    return new Promise((resolve, reject) => {
      jwt.sign(payload, this.options.secret, combinedOptions, (err, encoded) => {
        if (err || !encoded) {
          reject(err ?? new Error('Failed to sign JWT'));
        } else {
          resolve(encoded);
        }
      });
    });
  }

  sign(payload: string | Buffer | object, options?: SignOptions): string {
    const combinedOptions: SignOptions = {
      ...(this.options.signOptions ?? {}),
      ...(options ?? {}),
    };
    return jwt.sign(payload, this.options.secret, combinedOptions);
  }

  verify<T extends object = Record<string, unknown>>(token: string, options?: jwt.VerifyOptions): T {
    return jwt.verify(token, this.options.secret, options) as T;
  }
}
