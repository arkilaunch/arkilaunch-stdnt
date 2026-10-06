/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_PLATFORM_DOMAIN?: string;
  readonly VITE_PLATFORM_CONTACT_EMAIL?: string;
  readonly VITE_PLATFORM_CONTACT_PHONE?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_ENABLE_IN_APP_NEGOTIATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
