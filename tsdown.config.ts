import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: { index: 'packages/core/src/index.ts', shared: 'packages/core/src/shared.ts', 'remote-contract': 'packages/core/src/remote-contract.ts', model: 'packages/core/src/model.ts', isolation: 'packages/core/src/isolation.ts' }, outDir: 'packages/core/dist',
    format: 'esm', platform: 'node', target: 'es2023',
    dts: true, sourcemap: true, clean: true, fixedExtension: false,
    deps: { onlyBundle: ['zod'], neverBundle: [/^@deepseek-ai\//] },
  },
  {
    entry: { index: 'packages/web/src/client/index.ts' }, outDir: 'packages/web/dist/client',
    format: 'cjs', platform: 'browser', target: 'es2023',
    dts: false, sourcemap: true, clean: false, fixedExtension: false,
    inputOptions: { platform: 'browser' },
    deps: { alwaysBundle: [/^dsh-tiered-plugin-core\//], neverBundle: [/^@deepseek-ai\//, /^react(?:-dom)?($|\/)/] },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    outputOptions: {
      entryFileNames: 'index.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-tiered-plugin-menu", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
  ...['web', 'tui', 'dsh-go'].map(folder => ({
    entry: { index: `packages/${folder}/src/index.ts` }, outDir: `packages/${folder}/dist`,
    format: 'esm' as const, platform: 'node' as const, target: 'es2023',
    dts: true, sourcemap: true, clean: false, fixedExtension: false,
    deps: { neverBundle: [/^@deepseek-ai\//, /^dsh-tiered-plugin-core($|\/)/] },
  })),
])
