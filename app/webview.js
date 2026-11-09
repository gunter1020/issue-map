// webview-bun 發的是 .ts 原始碼，它的 Pointer 用法過不了這裡的 strict 檢查（skipLibCheck 只管
// .d.ts）。從 .js 轉出去，型別改由旁邊的 webview.d.ts 只宣告這裡用到的那幾個。
export { Webview } from 'webview-bun'
