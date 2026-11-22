import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { patchWebviewLoader } from '../app/build.ts'

/**
 * `app/build.ts` 用字串定位替換 `webview-bun/src/ffi.ts` 來內嵌動態函式庫；
 * 這裡在 CI（包含 Linux）上確認套件升級後那兩個定位標記還在。
 */
describe('app 打包相容性', () => {
  test('webview-bun 的 loader 標記還在，可正常改寫為內嵌檔案', async () => {
    const root = join(import.meta.dir, '..')
    const webviewDir = dirname(Bun.resolveSync('webview-bun/package.json', root))
    const ffiSource = await readFile(join(webviewDir, 'src/ffi.ts'), 'utf8')
    const patched = patchWebviewLoader(ffiSource, '/tmp/libwebview.dylib')

    expect(patched).toContain(
      'import embedded from "/tmp/libwebview.dylib" with { type: \'file\' };',
    )
    expect(patched).toContain('const lib_file = { default: embedded };')
    expect(patched).toContain('export const lib = dlopen')
  })

  test('套件改版導致標記找不到時直接失敗', () => {
    expect(() => patchWebviewLoader('export const lib = dlopen()', '/tmp/x.dylib')).toThrow(
      'webview-bun changed its native loader',
    )
  })
})
