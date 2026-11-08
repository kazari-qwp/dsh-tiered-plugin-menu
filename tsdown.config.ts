import { defineConfig } from 'tsdown'
import { originalClient } from './build/original-client.ts'

const clientExternals = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives']

export default defineConfig([
  {
    entry: { index: 'src/index.ts' }, outDir: 'dist',
    format: 'esm', platform: 'node', target: 'es2023',
    dts: true, sourcemap: true, clean: true, fixedExtension: false,
    deps: { onlyBundle: ['zod'], neverBundle: [/^@deepseek-ai\//, /^dsh-temporary-messages/] },
  },
  {
    entry: { index: 'src/client/index.ts' }, outDir: 'dist/client',
    format: 'cjs', platform: 'browser', target: 'es2023',
    dts: false, sourcemap: true, clean: false, fixedExtension: false,
    inputOptions: { platform: 'browser' },
    plugins: ['dsh-temporary-messages/client', 'dsh-context/client'].map(id => originalClient(id, clientExternals, 'dsh-tiered-plugin-menu')),
    deps: { neverBundle: [/^@deepseek-ai\//, /^react(?:-dom)?($|\/)/], alwaysBundle: [/^dsh-(temporary-messages|context)\//] },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    outputOptions: {
      entryFileNames: 'index.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-tiered-plugin-menu", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
