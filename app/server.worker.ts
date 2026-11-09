/**
 * 在 worker 裡起 server，起好就把網址回報給主執行緒；收到 `stop` 就關掉。
 * 協定只有這兩句，型別在 `main.ts` 那一側的 `WorkerMessage`。
 */

import { parentPort, workerData } from 'node:worker_threads'

import { startServer, type ServerOptions } from './server.ts'

try {
  const server = startServer(workerData as ServerOptions)
  parentPort?.on('message', (message) => {
    if (message !== 'stop') return
    void server.stop()
    parentPort?.close()
  })
  parentPort?.postMessage({ type: 'ready', url: server.url })
} catch (error) {
  parentPort?.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  })
  parentPort?.close()
}
