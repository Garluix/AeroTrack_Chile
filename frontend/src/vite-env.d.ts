/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_URL?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_INITIAL_LAT?: string;
  readonly VITE_INITIAL_LON?: string;
  readonly VITE_INITIAL_ZOOM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
