import { defineConfig } from 'tsdown'

const entry = (path: string) => ({
  entry: [path],
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024' as const,
  fixedExtension: false,
  dts: false,
  clean: false,
})

/** Build both Loader entries — the host service and the preset-mounted `./tool` — as self-contained bundles. */
export default defineConfig([
  entry('lib/types/index.js'),
  entry('lib/types/tool.js'),
])
