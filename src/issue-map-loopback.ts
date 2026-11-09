/**
 * 本機 server 的網路邊界。CLI server 與 app 的 server 共用這一份。
 *
 * 這兩個 server 都會拿使用者的 gh 登入去讀 repo，所以：
 * - 只聽 loopback，同網段的機器連不進來。
 * - 只接受 Host 指向自己的請求。DNS rebinding 會讓惡意網頁的網域解析到 127.0.0.1，請求確實打得
 *   進來，但 Host 帶的是對方的網域；擋 Host 就讀不到回應。
 */

/** server 綁的位址，也是印給人點的網址。 */
export const LOOPBACK = '127.0.0.1'

/**
 * Host 是不是指向這個 server。`localhost` 也算：舊版印的網址與書籤用的是它，而 rebinding 的
 * 網頁沒辦法讓瀏覽器送出 `Host: localhost`。
 *
 * `port` 是 `server.port`；聽 unix socket 的 server 沒有 port，那就沒有 Host 對得上，一律擋。
 */
export function isOwnHost(host: string | null, port: number | undefined): boolean {
  if (port === undefined) return false
  return host === `${LOOPBACK}:${port}` || host === `localhost:${port}`
}
