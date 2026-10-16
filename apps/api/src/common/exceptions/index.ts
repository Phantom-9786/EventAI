import { HttpError } from '../../express/types';

export class HttpException extends HttpError {
  public readonly response: string | Record<string, unknown>;

  constructor(
    responseData: string | Record<string, unknown>,
    status: number,
  ) {
    super(
      status,
      typeof responseData === 'string'
        ? responseData
        : ((responseData as { message?: string | string[] }).message ?? 'Http Exception'),
      typeof responseData === 'object' && responseData !== null
        ? ((responseData as { error?: string }).error ?? undefined)
        : undefined,
    );
    this.response = responseData;
    this.name = this.constructor.name;
  }

  getStatus(): number {
    return this.statusCode;
  }

  getResponse(): string | Record<string, unknown> {
    return this.response;
  }
}

export class BadRequestException extends HttpException {
  constructor(message: string | Record<string, unknown> = 'Bad Request', error = 'Bad Request') {
    super(typeof message === 'string' ? { message, error, statusCode: 400 } : message, 400);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message: string | Record<string, unknown> = 'Unauthorized', error = 'Unauthorized') {
    super(typeof message === 'string' ? { message, error, statusCode: 401 } : message, 401);
  }
}

export class ForbiddenException extends HttpException {
  constructor(message: string | Record<string, unknown> = 'Forbidden', error = 'Forbidden') {
    super(typeof message === 'string' ? { message, error, statusCode: 403 } : message, 403);
  }
}

export class NotFoundException extends HttpException {
  constructor(message: string | Record<string, unknown> = 'Not Found', error = 'Not Found') {
    super(typeof message === 'string' ? { message, error, statusCode: 404 } : message, 404);
  }
}

export class ConflictException extends HttpException {
  constructor(message: string | Record<string, unknown> = 'Conflict', error = 'Conflict') {
    super(typeof message === 'string' ? { message, error, statusCode: 409 } : message, 409);
  }
}

export class InternalServerErrorException extends HttpException {
  constructor(message: string | Record<string, unknown> = 'Internal Server Error', error = 'Internal Server Error') {
    super(typeof message === 'string' ? { message, error, statusCode: 500 } : message, 500);
  }
}

export class BadGatewayException extends HttpException {
  constructor(message: string | Record<string, unknown> = 'Bad Gateway', error = 'Bad Gateway') {
    super(typeof message === 'string' ? { message, error, statusCode: 502 } : message, 502);
  }
}

export class ServiceUnavailableException extends HttpException {
  constructor(message: string | Record<string, unknown> = 'Service Unavailable', error = 'Service Unavailable') {
    super(typeof message === 'string' ? { message, error, statusCode: 503 } : message, 503);
  }
}

export class PayloadTooLargeException extends HttpException {
  constructor(message: string | Record<string, unknown> = 'Payload Too Large', error = 'Payload Too Large') {
    super(typeof message === 'string' ? { message, error, statusCode: 413 } : message, 413);
  }
}

export class UnsupportedMediaTypeException extends HttpException {
  constructor(message: string | Record<string, unknown> = 'Unsupported Media Type', error = 'Unsupported Media Type') {
    super(typeof message === 'string' ? { message, error, statusCode: 415 } : message, 415);
  }
}

export function Injectable(): ClassDecorator {
  return () => {};
}

export function Optional(): ParameterDecorator {
  return () => {};
}

export function SetMetadata<K = string, V = any>(_metadataKey: K, _metadataValue: V): CustomDecorator {
  return () => {};
}

export type CustomDecorator = MethodDecorator & ClassDecorator;

export class Logger {
  constructor(private readonly context?: string) {}

  log(message: any, ...optionalParams: any[]) {
    // eslint-disable-next-line no-console
    console.log(`[${this.context ?? 'App'}] ${message}`, ...optionalParams);
  }

  error(message: any, trace?: string, ...optionalParams: any[]) {
    // eslint-disable-next-line no-console
    console.error(`[${this.context ?? 'App'}] ${message}`, trace ?? '', ...optionalParams);
  }

  warn(message: any, ...optionalParams: any[]) {
    // eslint-disable-next-line no-console
    console.warn(`[${this.context ?? 'App'}] ${message}`, ...optionalParams);
  }

  debug(message: any, ...optionalParams: any[]) {
    // eslint-disable-next-line no-console
    console.debug(`[${this.context ?? 'App'}] ${message}`, ...optionalParams);
  }
}

export interface OnModuleInit {
  onModuleInit(): Promise<void> | void;
}

export interface OnModuleDestroy {
  onModuleDestroy(): Promise<void> | void;
}

export enum HttpStatus {
  CONTINUE = 100,
  SWITCHING_PROTOCOLS = 101,
  PROCESSING = 102,
  EARLYHINTS = 103,
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  NON_AUTHORITATIVE_INFORMATION = 203,
  NO_CONTENT = 204,
  RESET_CONTENT = 205,
  PARTIAL_CONTENT = 206,
  AMBIGUOUS = 300,
  MOVED_PERMANENTLY = 301,
  FOUND = 302,
  SEE_OTHER = 303,
  NOT_MODIFIED = 304,
  TEMPORARY_REDIRECT = 307,
  PERMANENT_REDIRECT = 308,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  PAYMENT_REQUIRED = 402,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  NOT_ACCEPTABLE = 406,
  PROXY_AUTHENTICATION_REQUIRED = 407,
  REQUEST_TIMEOUT = 408,
  CONFLICT = 409,
  GONE = 410,
  LENGTH_REQUIRED = 411,
  PRECONDITION_FAILED = 412,
  PAYLOAD_TOO_LARGE = 413,
  URI_TOO_LONG = 414,
  UNSUPPORTED_MEDIA_TYPE = 415,
  REQUESTED_RANGE_NOT_SATISFIABLE = 416,
  EXPECTATION_FAILED = 417,
  I_AM_A_TEAPOT = 418,
  MISDIRECTED = 421,
  UNPROCESSABLE_ENTITY = 422,
  FAILED_DEPENDENCY = 424,
  PRECONDITION_REQUIRED = 428,
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500,
  NOT_IMPLEMENTED = 501,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
  GATEWAY_TIMEOUT = 504,
  HTTP_VERSION_NOT_SUPPORTED = 505,
}

export interface ExecutionContext {
  switchToHttp(): {
    getRequest<T = any>(): T;
    getResponse<T = any>(): T;
    getNext<T = any>(): T;
  };
  getClass<T = any>(): T;
  getHandler(): (...args: any[]) => any;
  getArgs<T extends Array<any> = any[]>(): T;
  getArgByIndex<T = any>(index: number): T;
}

export interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}
