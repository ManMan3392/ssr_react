declare global {
  interface Window {
    __SSR_DATA__?: Record<string, unknown>;
  }
}

export {};
