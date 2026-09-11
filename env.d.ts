declare namespace Cloudflare {
  interface Env {
    FILES: R2Bucket;
  }
}

interface ImportMeta {
  readonly env: { readonly DEV: boolean };
}
