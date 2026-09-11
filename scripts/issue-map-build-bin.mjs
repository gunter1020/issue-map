#!/usr/bin/env node
/** `issue-map-build` 的進入點：產出靜態 HTML。轉發與錯誤訊息都在 `issue-map-bin.mjs`。 */

import { runWithBun } from './issue-map-bin.mjs'

runWithBun('issue-map.ts')
