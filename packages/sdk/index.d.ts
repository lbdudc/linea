export const HOST_API_VERSION: string;
export function verifyEventSignature(secret: string, rawBody: string | Buffer, header: string | string[] | undefined): boolean;
export function signEvent(secret: string, rawBody: string | Buffer): string;
export function serviceClient(options: { baseUrl: string; key: string; fetchFn?: typeof fetch }): {
  request(path: string, options: { actAs: string; method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal }): Promise<any>;
  get(path: string, options: { actAs: string }): Promise<any>;
  post(path: string, body: unknown, options: { actAs: string }): Promise<any>;
};
export function healthStatus(extra?: Record<string, unknown>): { status: 'ok' } & Record<string, unknown>;
export function readBody(request: import('node:http').IncomingMessage, limit?: number): Promise<Buffer>;

/** `ctx`: what the host gives `register(ctx)` of a plugin's `server` entry. */
export interface PluginContext {
  id: string;
  dir: string;
  isEnabled(): boolean;
  settings(): Record<string, any>;
  onSettingsChange(fn: (fresh: Record<string, any>, previous: Record<string, any>) => void | Promise<void>): void;
  router(): import('express').Router;
  alias(prefix: string | RegExp, base?: string | ((match: RegExpExecArray) => string)): void;
  events: { on(name: string, listener: (...args: any[]) => void): void };
  services: {
    requireAuth: import('express').RequestHandler; requireAdmin: import('express').RequestHandler; asyncHandler: Function;
    rateLimit: Function; handleValidationErrors: import('express').RequestHandler; errors: Record<string, any>; userRepository: any;
  };
}

/** `ui`: what the host gives `register(ui)` of a plugin's `client` entry. */
export interface PluginUi {
  plugin: string;
  router: any;
  info: { id: string; version: string; web: string | null; settings: Record<string, any> };
  settings: Record<string, any>;
  api: import('axios').AxiosInstance;
  addNav(item: { id: string; icon?: string; label: string | Record<string, string>; to?: string | object; href?: string; activeFor?: string[] }): void;
  addRoute(route: { path: string; component: any; name?: string; props?: any }): void;
  addPages(pages: { path: string; shell: any; children: { path: string; name?: string; component: any }[] }): void;
  addSlot(name: 'line.tabs' | 'product.tabs' | 'featureModel.strip' | 'featureModel.actions' | 'featureModel.panels' | 'line.create.fields' | 'dashboard.widgets', component: any, options?: { id?: string; when?: (context: any) => boolean; order?: number }): void;
  addI18n(messages: Record<string, any>, options?: { keepExisting?: boolean }): void;
}
