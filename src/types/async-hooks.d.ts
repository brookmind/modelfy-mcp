// The part of `node:async_hooks` this Worker uses. The runtime provides it
// through the `nodejs_compat` flag (wrangler.jsonc); the project does not pull
// in the full Node type definitions.
declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    run<R>(store: T, callback: () => R): R;
    getStore(): T | undefined;
  }
}
