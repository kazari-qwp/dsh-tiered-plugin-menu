import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' }, outDir: 'dist',
    format: 'esm', platform: 'node', target: 'es2023',
    dts: true, sourcemap: true, clean: true, fixedExtension: false,
    deps: { onlyBundle: ['zod'], neverBundle: [/^@deepseek-ai\//] },
  },
  {
    entry: { index: 'src/client/index.ts' }, outDir: 'dist/client',
    format: 'cjs', platform: 'browser', target: 'es2023',
    dts: false, sourcemap: true, clean: false, fixedExtension: false,
    inputOptions: { platform: 'browser' },
    deps: { neverBundle: [/^@deepseek-ai\//, /^react(?:-dom)?($|\/)/] },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    outputOptions: {
      entryFileNames: 'index.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-tiered-plugin-menu", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
