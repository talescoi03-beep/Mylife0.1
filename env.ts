// Public build-time configuration injected by scripts/build.mjs.
declare const __APP_CONFIG__: { supabaseUrl: string; supabaseKey: string; apiUrl: string } | undefined;
declare const __BUILD_ID__: string | undefined;

const injected = typeof __APP_CONFIG__ !== 'undefined' ? __APP_CONFIG__ : { supabaseUrl: '', supabaseKey: '', apiUrl: '' };

export const config = {
  supabaseUrl: injected.supabaseUrl,
  supabaseKey: injected.supabaseKey,
  apiUrl: injected.apiUrl,
  buildId: typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev',
};

export const isConfigured = Boolean(config.supabaseUrl && config.supabaseKey);
