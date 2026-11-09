#!/usr/bin/env bun
/**
 * 把 app 編成 macOS 的 `issue-map.app`：一個執行檔裝下 Bun、server worker、畫面程式、樣板與
 * WebView 的原生函式庫，放進 `dist/app/<target>/issue-map.app`。
 *
 *   bun run app:build                      # 這台 Mac 的架構
 *   bun run app:build bun-darwin-x64       # 指定架構
 *
 * 這是本機用的開發建置：ad-hoc 簽章、沒有公證，拿到別台 Mac 會被 Gatekeeper 擋。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { version } from '../package.json'
import { bundleClient } from '../src/issue-map.ts'

const TARGETS = ['bun-darwin-arm64', 'bun-darwin-x64'] as const
type Target = (typeof TARGETS)[number]

const NAME = 'issue-map'
const BUNDLE_ID = 'io.github.gunter1020.issue-map'

const requested = process.argv[2] ?? `bun-darwin-${process.arch}`
const target = TARGETS.find((candidate) => candidate === requested)
if (!target) {
  console.error(`Unsupported target: ${requested} (supported: ${TARGETS.join(', ')})`)
  process.exit(2)
}

const root = join(import.meta.dir, '..')
const webviewDir = dirname(Bun.resolveSync('webview-bun/package.json', root))

/**
 * webview-bun 執行時用 `import('../build/libwebview.dylib')` 找原生函式庫，編譯後那個相對路徑不
 * 存在。把那一段換成內嵌檔案的 import，函式庫就跟著進執行檔。依賴的是它 loader 的寫法，所以對不上
 * 就直接失敗，不要編出一個開不了窗的 app。
 */
const embedWebview: Bun.BunPlugin = {
  name: 'embed-webview-library',
  setup(builder) {
    builder.onLoad({ filter: /webview-bun[\\/]src[\\/]ffi\.ts$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8')
      const start = source.indexOf('let lib_file;')
      const end = source.indexOf('export const lib = dlopen')
      if (start < 0 || end < start) {
        throw new Error('webview-bun changed its native loader; update app/build.ts')
      }
      const library = join(webviewDir, 'build/libwebview.dylib')
      return {
        loader: 'ts',
        contents: `${source.slice(0, start)}import embedded from ${JSON.stringify(library)} with { type: 'file' };\nconst lib_file = { default: embedded };\n${source.slice(end)}`,
      }
    })
  },
}

function infoPlist(): string {
  const entries: [string, string][] = [
    ['CFBundleExecutable', NAME],
    ['CFBundleIdentifier', BUNDLE_ID],
    ['CFBundleName', NAME],
    ['CFBundleDisplayName', NAME],
    ['CFBundleVersion', version],
    ['CFBundleShortVersionString', version],
    ['CFBundlePackageType', 'APPL'],
  ]
  const body = entries.map(([key, value]) => `<key>${key}</key><string>${value}</string>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${body}<key>NSHighResolutionCapable</key><true/></dict></plist>
`
}

async function buildApp(arch: Target): Promise<string> {
  const bundle = join(root, 'dist/app', arch, `${NAME}.app`)
  const outfile = join(bundle, 'Contents/MacOS', NAME)
  await rm(bundle, { recursive: true, force: true })
  await mkdir(dirname(outfile), { recursive: true })

  // compile 會把暫存檔留在 cwd（oven-sh/bun#14020），換到暫存目錄跑完再清掉。
  const scratch = await mkdtemp(join(tmpdir(), 'issue-map-build-'))
  const origin = process.cwd()
  process.chdir(scratch)
  try {
    const result = await Bun.build({
      // worker 要列成 entrypoint 才會被打包進去，`main.ts` 用相對路徑找它。
      entrypoints: [join(root, 'app/main.ts'), join(root, 'app/server.worker.ts')],
      compile: { target: arch, outfile },
      minify: true,
      define: { ISSUE_MAP_CLIENT: JSON.stringify(await bundleClient()) },
      plugins: [embedWebview],
    })
    if (!result.success) throw new AggregateError(result.logs, `Build failed: ${arch}`)
  } finally {
    process.chdir(origin)
    await rm(scratch, { recursive: true, force: true })
  }

  await writeFile(join(bundle, 'Contents/Info.plist'), infoPlist())
  // 加了 Info.plist 之後要重簽整個 bundle，不然簽章對不上 bundle 內容，Finder 會說 app 已損毀。
  const signed = Bun.spawnSync(['codesign', '--force', '--sign', '-', bundle], {
    stdout: 'ignore',
    stderr: 'pipe',
  })
  if (!signed.success) throw new Error(`codesign failed: ${signed.stderr.toString().trim()}`)
  return bundle
}

console.log(`Built ${await buildApp(target)} (development build, ad-hoc signed)`)
