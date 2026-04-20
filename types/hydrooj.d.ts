/**
 * Minimal type stubs for the `hydrooj` host environment.
 * This file is referenced via tsconfig `paths` so TypeScript uses these
 * declaration-only types instead of trying to compile hydrooj's raw .ts sources.
 *
 * Types are shaped to match the public API documented in
 * https://hydro-plugin-api-reference.pages.dev and hydrooj's source.
 */
declare module 'hydrooj' {
  import type {
    Collection,
    Filter,
    WithId,
    UpdateFilter,
    FindOptions,
    InsertOneOptions,
    UpdateOptions,
    OptionalUnlessRequiredId,
  } from 'mongodb';

  // ----------------------------------------------------------------
  // Collections augmentation interface
  // Plugins extend this via `declare module 'hydrooj' { interface Collections { ... } }`
  // ----------------------------------------------------------------
  /** @see hydrooj/src/service/db.ts */
  interface Collections {}

  /** @see hydrooj/src/service/db.ts MongoService */
  const db: {
    collection<K extends keyof Collections>(name: K): Collection<Collections[K]>;
  };

  // ----------------------------------------------------------------
  // Context (cordis-based plugin context)
  // @see hydrooj/src/context.ts, hydrooj/src/service/server.ts
  // ----------------------------------------------------------------
  class Context {
    Route(
      name: string,
      path: string,
      HandlerClass: { new(...args: unknown[]): Handler },
      ...permPrivChecker: number[]
    ): void;
    plugin(plugin: (ctx: Context) => void): void;
    on(event: string, callback: (...args: unknown[]) => unknown): () => void;
    emit(event: string, ...args: unknown[]): void;
    parallel(event: string, ...args: unknown[]): Promise<void>;
  }

  // ----------------------------------------------------------------
  // Handler
  // @see @hydrooj/framework/server.ts HandlerCommon / Handler
  // ----------------------------------------------------------------
  interface HydroRequest {
    /** Parsed URL path parameters (e.g. :teamId) */
    params: Record<string, string>;
    /** Parsed POST body */
    body: Record<string, unknown>;
    query: Record<string, unknown>;
    headers: Record<string, string | string[] | undefined>;
    ip: string;
    path: string;
    originalPath: string;
    method: string;
  }

  interface HydroResponse {
    body: unknown;
    template: string | undefined;
    redirect: string | undefined;
    status: number;
    type: string;
  }

  interface UserModel {
    _id: number;
    uname: string;
    [key: string]: unknown;
  }

  class HandlerCommon {
    session: Record<string, unknown>;
    request: HydroRequest;
    response: HydroResponse;
    args: Record<string, unknown>;
    UiContext: Record<string, unknown>;
    user: UserModel;
    checkPerm(...perms: bigint[]): void;
    checkPriv(...privs: number[]): void;
    url(name: string, args?: Record<string, string>): string;
    renderHTML(template: string, data?: Record<string, unknown>): Promise<void>;
  }

  class Handler extends HandlerCommon {
    get(domainId?: string, ...args: unknown[]): Promise<void> | void;
    post(domainId?: string, ...args: unknown[]): Promise<void> | void;
  }

  // ----------------------------------------------------------------
  // PRIV — system-level privilege flags
  // @see hydrooj/src/model/builtin.ts
  // ----------------------------------------------------------------
  const PRIV: {
    PRIV_NONE: number;
    PRIV_EDIT_SYSTEM: number;
    PRIV_USER_PROFILE: number;
    PRIV_REGISTER_USER: number;
    PRIV_READ_PROBLEM_DATA: number;
    PRIV_JUDGE: number;
    PRIV_CREATE_DOMAIN: number;
    PRIV_VIEW_ALL_DOMAIN: number;
    PRIV_MANAGE_ALL_DOMAIN: number;
    PRIV_VIEW_USER_SECRET: number;
    PRIV_UNLIMITED_ACCESS: number;
    [key: string]: number;
  };

  // ----------------------------------------------------------------
  // Error classes
  // @see @hydrooj/framework/error.ts, hydrooj/src/error.ts
  // ----------------------------------------------------------------
  class HydroError extends Error {
    params: unknown[];
    constructor(...args: unknown[]);
  }
  class UserFacingError extends HydroError {}
  class BadRequestError extends UserFacingError {}
  class ForbiddenError extends UserFacingError {}
  class PermissionError extends ForbiddenError {}
  class NotFoundError extends UserFacingError {}

  // ----------------------------------------------------------------
  // Parameter decorators
  // @see @hydrooj/framework/decorators.ts
  // ----------------------------------------------------------------
  type Type<T = unknown> = unknown;
  const Types: {
    String: Type<string>;
    ShortString: Type<string>;
    Title: Type<string>;
    Content: Type<string>;
    Int: Type<number>;
    UnsignedInt: Type<number>;
    PositiveInt: Type<number>;
    Float: Type<number>;
    Boolean: Type<boolean>;
    [key: string]: Type<unknown>;
  };
  function param(name: string, type?: Type, isOptional?: boolean): MethodDecorator;
  function query(name: string, type?: Type, isOptional?: boolean): MethodDecorator;
  function post(name: string, type?: Type, isOptional?: boolean): MethodDecorator;
  function route(name: string, type?: Type, isOptional?: boolean): MethodDecorator;

  // ----------------------------------------------------------------
  // Model augmentation extension point
  // Plugins extend this via `declare module 'hydrooj' { interface Model { ... } }`
  // ----------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Model {}
}
