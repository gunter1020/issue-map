/**
 * 主執行緒掛到頁面上的全域函式名。`main.ts` 用它 `bind`，頁面（`pages.ts`、注入的 script）用它
 * 呼叫——兩邊各寫一份字串的話，改了一邊另一邊就安靜地失效。
 */

/** 把別的 origin 的連結交給系統瀏覽器。 */
export const OPEN_EXTERNAL = '__issueMapOpenExternal'

/** 開原生對話框選資料夾，回傳路徑或 `null`。只有 macOS 的視窗掛這個；頁面靠它在不在決定顯不顯示按鈕。 */
export const PICK_FOLDER = '__issueMapPickFolder'
