/**
 * 交給系統預設瀏覽器開網址。CLI 的 `--open` 與 app 裡的 GitHub 連結共用這一份。
 *
 * **打不開不算失敗**：呼叫端都已經有別的路（CLI 印了網址，app 的頁面還在），只說一聲。
 */

import { spawnSync } from 'bun'

export function openInBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url]
  const result = spawnSync(command, { stdout: 'ignore', stderr: 'pipe' })
  if (!result.success) {
    console.error(
      `Could not open the browser (${command[0]}: ${result.stderr.toString().trim()}) — open ${url} yourself`,
    )
  }
}
