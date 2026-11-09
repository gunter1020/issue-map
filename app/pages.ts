/**
 * app 自己的幾個畫面：選 repo、地圖上方的工具列、抓不到時的錯誤頁。
 *
 * 地圖本身照舊由 `src/issue-map.ts` 渲染，這裡只負責 app 多出來的外框。文案只有英文，跟 CLI
 * 那一側一樣——四種語言的字典屬於地圖頁，切換記在頁面自己的 localStorage。
 */

import { documentOf } from '../src/issue-map.ts'
import { esc } from '../src/issue-map-view.ts'

/** 地圖頁的網址。owner 與 name 都已經過 `parseRepo`，不會有需要編碼的字。 */
export function mapPath(repo: string): string {
  return `/r/${repo}`
}

/**
 * 抓一次 GitHub 要好幾秒，而 WebView 在新頁回來之前會停在舊頁上，看起來像沒點到。
 * 點連結或送出表單時先把字換掉，讓人知道正在抓。
 */
const LOADING_SCRIPT = `<script>
addEventListener('click', (event) => {
  const link = event.target.closest && event.target.closest('a[data-loading]')
  if (link) link.textContent = link.dataset.loading
})
addEventListener('submit', (event) => {
  const button = event.target.querySelector('button[data-loading]')
  if (button) { button.textContent = button.dataset.loading; button.disabled = true }
})
</script>`

const PICKER_STYLE = `<style>
  :root {
    --paper: #f4f6f7; --card: #ffffff; --ink: #13181d; --muted: #626d78;
    --line: #dce1e6; --accent: #0f7b5f; --error: #b42318; color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #11151a; --card: #181d24; --ink: #e8ecf0; --muted: #9aa4af;
      --line: #262d36; --accent: #4fbf94; --error: #f97066; color-scheme: dark;
    }
  }
  body {
    margin: 0; min-height: 100vh; background: var(--paper); color: var(--ink);
    font: 15px/1.5 system-ui, -apple-system, 'PingFang TC', sans-serif;
  }
  main { max-width: 560px; margin: 0 auto; padding: 56px 16px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  p { color: var(--muted); margin: 0 0 24px; }
  form { display: flex; gap: 8px; }
  input {
    flex: 1; min-width: 0; padding: 10px 12px; font: 15px ui-monospace, 'SF Mono', Menlo, monospace;
    color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 8px;
  }
  button {
    padding: 10px 16px; font: inherit; font-weight: 600; color: #fff; background: var(--accent);
    border: 0; border-radius: 8px; cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .error { color: var(--error); margin: 12px 0 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 40px 0 8px; }
  ul { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
  li + li { border-top: 1px solid var(--line); }
  li a {
    display: block; padding: 10px 12px; color: var(--ink); text-decoration: none;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  }
  li a:hover { background: var(--paper); }
</style>`

/** 首頁：輸入 repo，或從最近開過的裡挑一個。 */
export function pickerPage(recent: readonly string[], error?: { input: string; message: string }) {
  const list = recent.length
    ? `<h2>Recent</h2><ul>${recent
        .map(
          (repo) =>
            `<li><a href="${esc(mapPath(repo))}" data-loading="${esc(`${repo} — fetching…`)}">${esc(repo)}</a></li>`,
        )
        .join('')}</ul>`
    : ''
  const problem = error ? `<p class="error" role="alert">${esc(error.message)}</p>` : ''
  return documentOf(`<title>issue-map</title>${PICKER_STYLE}
<main>
  <h1>issue-map</h1>
  <p>Draw a repo's issue dependencies. Uses your <code>gh</code> login; every open re-fetches from GitHub.</p>
  <form action="/open" method="get">
    <input name="repo" value="${esc(error?.input ?? '')}" placeholder="owner/name or a GitHub URL"
      aria-label="Repository" autofocus autocomplete="off" autocapitalize="off" spellcheck="false" required>
    <button data-loading="Fetching…">Open map</button>
  </form>
  ${problem}
  ${list}
</main>${LOADING_SCRIPT}`)
}

const BAR_STYLE = `<style>
  .app-bar {
    display: flex; align-items: center; gap: 16px; padding: 8px 16px;
    background: var(--card); border-bottom: 1px solid var(--line);
    font: 13px var(--body); color: var(--muted);
  }
  .app-bar a { color: var(--ink); text-decoration: none; font-weight: 600; }
  .app-bar a:hover { text-decoration: underline; }
  .app-bar .repo { font-family: var(--mono); color: var(--ink); }
  .app-bar .spacer { flex: 1; }
</style>`

/** 地圖頁：上方一條工具列（回首頁、重新整理），底下是原本的地圖。 */
export function mapPage(repo: string, mapFragment: string): string {
  const bar = `${BAR_STYLE}<nav class="app-bar">
  <a href="/">← Repos</a>
  <span class="repo">${esc(repo)}</span>
  <span class="spacer"></span>
  <a href="${esc(mapPath(repo))}" data-loading="Fetching…">Refresh</a>
</nav>`
  return documentOf(`${bar}${mapFragment}${LOADING_SCRIPT}`)
}

/** 抓不到：把 gh 說的原話給人看，並給回首頁與重試兩條路。 */
export function errorPage(repo: string, message: string): string {
  return documentOf(`<title>issue-map — ${esc(repo)}</title>${PICKER_STYLE}
<main>
  <h1>Could not draw ${esc(repo)}</h1>
  <p class="error" role="alert" style="white-space: pre-wrap">${esc(message)}</p>
  <p><a href="${esc(mapPath(repo))}" data-loading="Fetching…">Try again</a> · <a href="/">Back to repos</a></p>
</main>${LOADING_SCRIPT}`)
}
