/** Version info, compiled in by build.mjs (falls back to 'dev' when run unbundled). */
declare const __DICESHEET_VERSION__: string;
declare const __DICECLOUD_UPSTREAM__: string;
declare const __BUILT_AT__: string;
export const VERSION = typeof __DICESHEET_VERSION__ !== 'undefined' ? __DICESHEET_VERSION__ : 'dev';
export const ENGINE = typeof __DICECLOUD_UPSTREAM__ !== 'undefined' ? __DICECLOUD_UPSTREAM__ : 'unknown';
export const BUILT_AT = typeof __BUILT_AT__ !== 'undefined' ? __BUILT_AT__ : undefined;
export const STARTED_AT = new Date().toISOString();
