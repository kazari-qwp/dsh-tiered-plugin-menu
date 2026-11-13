// Keep the original direct-core API usable while the managed bundle supplies
// an idle host whose backend lifetime follows its interface components.
export { applyHost as apply, Config, inject, tieredManagerFrontend } from './index.ts'
export const name = 'tiered-plugin-core-host'
