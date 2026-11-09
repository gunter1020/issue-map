import { describe, expect, test } from 'bun:test'

import { isOwnHost } from '../src/issue-map-loopback.ts'

/**
 * 本機 server 的 Host 閘門。放錯一個進來，別的網站就能透過 DNS rebinding 讀到用使用者 gh 登入
 * 抓的 repo；擋錯一個，使用者自己的分頁就打不開。
 */

describe('Host 閘門', () => {
  test('印出來的網址與 localhost 書籤都放行', () => {
    expect(isOwnHost('127.0.0.1:4747', 4747)).toBe(true)
    expect(isOwnHost('localhost:4747', 4747)).toBe(true)
  })

  /** rebinding 的請求打得進 loopback，但 Host 帶的是對方的網域。 */
  test('別的網域、別的 port、沒帶 Host 都擋', () => {
    expect(isOwnHost('evil.example:4747', 4747)).toBe(false)
    expect(isOwnHost('127.0.0.1:4748', 4747)).toBe(false)
    expect(isOwnHost('127.0.0.1', 4747)).toBe(false)
    expect(isOwnHost('192.168.1.10:4747', 4747)).toBe(false)
    expect(isOwnHost(null, 4747)).toBe(false)
  })

  /** 聽 unix socket 的 server 沒有 port，`localhost:undefined` 不能被當成對得上。 */
  test('沒有 port 就一律擋', () => {
    expect(isOwnHost('localhost:undefined', undefined)).toBe(false)
    expect(isOwnHost('127.0.0.1', undefined)).toBe(false)
  })
})
