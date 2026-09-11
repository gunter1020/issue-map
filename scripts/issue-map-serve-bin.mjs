#!/usr/bin/env node
/** `issue-map` 的進入點：本機 server。轉發與錯誤訊息都在 `issue-map-bin.mjs`。 */

import { runWithBun } from './issue-map-bin.mjs'

runWithBun('issue-map-serve.ts')
