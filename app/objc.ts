/**
 * 呼叫 Objective-C runtime 的最小工具，給 macOS 選單與選資料夾的對話框用。只在 macOS 上動態載入。
 *
 * `objc_msgSend` 要照每個方法實際的參數與回傳型別宣告，所以每種簽章各開一份。
 * https://developer.apple.com/documentation/objectivec/objective-c_runtime
 *
 * 一律在主執行緒呼叫：AppKit 只能在主執行緒上用。
 */

import { CString, dlopen, type Pointer } from 'bun:ffi'

/** Objective-C 物件。bun:ffi 的 `ptr` 回傳值可能是 number 或 bigint。 */
export type Id = Pointer | bigint

const LIB = '/usr/lib/libobjc.A.dylib'

const runtime = dlopen(LIB, {
  objc_getClass: { args: ['cstring'], returns: 'ptr' },
  sel_registerName: { args: ['cstring'], returns: 'ptr' },
})
const noArg = dlopen(LIB, { objc_msgSend: { args: ['ptr', 'ptr'], returns: 'ptr' } })
const oneArg = dlopen(LIB, { objc_msgSend: { args: ['ptr', 'ptr', 'ptr'], returns: 'ptr' } })
const threeArgs = dlopen(LIB, {
  objc_msgSend: { args: ['ptr', 'ptr', 'ptr', 'ptr', 'ptr'], returns: 'ptr' },
})
const boolArg = dlopen(LIB, { objc_msgSend: { args: ['ptr', 'ptr', 'bool'], returns: 'void' } })
const longResult = dlopen(LIB, { objc_msgSend: { args: ['ptr', 'ptr'], returns: 'i64' } })

const cstring = (value: string) => Buffer.from(`${value}\0`)

function must(value: Id | null, what: string): Id {
  if (!value) throw new Error(`Objective-C call returned nil: ${what}`)
  return value
}

export const sel = (name: string): Id => must(runtime.symbols.sel_registerName(cstring(name)), name)
export const cls = (name: string): Id => must(runtime.symbols.objc_getClass(cstring(name)), name)

/** 沒有參數、回傳物件。回傳 nil 就丟錯；要容許 nil 的用 `sendMaybe`。 */
export const send = (target: Id, name: string): Id =>
  must(noArg.symbols.objc_msgSend(target, sel(name)), name)

export const sendMaybe = (target: Id, name: string): Id | null =>
  noArg.symbols.objc_msgSend(target, sel(name))

export const sendWith = (target: Id, name: string, arg: Id): Id | null =>
  oneArg.symbols.objc_msgSend(target, sel(name), arg)

export const sendWith3 = (target: Id, name: string, a: Id, b: Id, c: Id): Id =>
  must(threeArgs.symbols.objc_msgSend(target, sel(name), a, b, c), name)

export const sendBool = (target: Id, name: string, value: boolean): void =>
  boolArg.symbols.objc_msgSend(target, sel(name), value)

/** 回傳 NSInteger 的方法，例如 `runModal`。 */
export const sendLong = (target: Id, name: string): number =>
  Number(longResult.symbols.objc_msgSend(target, sel(name)))

export const nsString = (value: string): Id =>
  must(
    oneArg.symbols.objc_msgSend(cls('NSString'), sel('stringWithUTF8String:'), cstring(value)),
    value,
  )

/** NSString 轉回 JS 字串。 */
export const jsString = (value: Id): string =>
  new CString(
    must(noArg.symbols.objc_msgSend(value, sel('UTF8String')), 'UTF8String') as Pointer,
  ).toString()

/** `alloc`／`new` 拿到的物件由呼叫端持有；交給 AppKit 之後要放掉自己那一份。 */
export const release = (target: Id): void => {
  noArg.symbols.objc_msgSend(target, sel('release'))
}
