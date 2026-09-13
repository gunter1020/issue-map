import { describe, expect, test } from 'bun:test'

import { type IssueFacts, type RepoFacts, type Rules, verdictOf } from '../scripts/issue-map.ts'

/**
 * 狀態機：一張票被畫成 ready / active / blocked / triage / done，還在等誰，下一步顯示什麼。
 *
 * 這是整個工具的核心語意。畫錯狀態是它最不能出的錯——讀圖的人會去接一張其實還被擋住的票。
 */

/**
 * 測試自己的一份字彙。跟 `CONFIG` 的預設值脫鉤是刻意的：這裡驗的是規則怎麼運作，不是預設標籤
 * 叫什麼名字。形狀照著出貨的設定——`human` 是 `ready` 的子集合，因為要人做的票也算評估完了。
 */
const RULES: Rules = {
  unready: ['needs-triage', 'needs-info'],
  ready: ['ready-for-agent', 'ready-for-human'],
  active: ['in-progress'],
  human: ['ready-for-human'],
  implementCommand: '/implement',
  triageCommand: '/triage',
}

/** 預設是「這個 repo 有在用 triage 標籤、沒有任何主票與阻擋者」。 */
function repo(extra: Partial<RepoFacts> = {}): RepoFacts {
  return {
    open: new Set(),
    openChildren: new Map(),
    parents: new Set(),
    triaged: true,
    rules: RULES,
    ...extra,
  }
}

/** 預設是一張評估完、沒人接、沒被擋的 open 票。 */
function issue(extra: Partial<IssueFacts> = {}): IssueFacts {
  return {
    number: 1,
    state: 'OPEN',
    labels: ['ready-for-agent'],
    assignees: [],
    blockedBy: [],
    ...extra,
  }
}

describe('已完成的票', () => {
  /**
   * 守的是「關掉的票一律是 done，不再看標籤與阻擋者」。
   *
   * 壞了會怎樣：關掉的票會被重新算成 triage 或 blocked。它們被帶進快照只是為了讓進度看得見，
   * 一旦跟著閘門跑，地圖上就會出現「等一張已經關掉的票」這種沒人能處理的節點。
   */
  test('CLOSED 就是 done，下一步沒有', () => {
    const verdict = verdictOf(
      issue({ state: 'CLOSED', labels: ['needs-triage'], blockedBy: [2] }),
      repo({ open: new Set([2]) }),
    )

    expect(verdict.status).toBe('done')
    expect(verdict.nextStep).toEqual({ kind: 'none' })
  })
})

describe('主票看的是子票', () => {
  /**
   * 守的是「還有子票開著的主票不會被畫成可接手」。
   *
   * 壞了會怎樣：主票自己不做事，它會出現在「現在可以接」那一欄，而真正要做的是它底下那幾張。
   */
  test('還有子票開著就是 blocked，下一步是等子票', () => {
    const verdict = verdictOf(
      issue({ number: 7 }),
      repo({ parents: new Set([7]), openChildren: new Map([[7, 3]]) }),
    )

    expect(verdict.isParent).toBe(true)
    expect(verdict.status).toBe('blocked')
    expect(verdict.nextStep).toEqual({ kind: 'waitChildren', count: 3 })
  })

  /**
   * 守的是「子票全關的主票會被指出來可以關掉」。
   *
   * 壞了會怎樣：做完的主票會一直留在圖上佔位置，沒有人知道它只差被關掉。
   */
  test('子票全關就是 ready，下一步是可以關掉', () => {
    const verdict = verdictOf(issue({ number: 7 }), repo({ parents: new Set([7]) }))

    expect(verdict.status).toBe('ready')
    expect(verdict.nextStep).toEqual({ kind: 'parentReady' })
  })

  /**
   * 守的是「主票不吃 triage 與 active 那兩條規則」。
   *
   * 壞了會怎樣：沒掛角色標籤的主票會被畫成待 triage，而主票本來就不是拿去做的東西。
   */
  test('主票沒掛角色標籤也不算待 triage', () => {
    const verdict = verdictOf(issue({ number: 7, labels: [] }), repo({ parents: new Set([7]) }))

    expect(verdict.status).toBe('ready')
  })
})

describe('triage 閘門', () => {
  /**
   * 守的是「掛著 unready 標籤的票不會被當成可接手」。
   *
   * 壞了會怎樣：還在等回報者補資訊的票會出現在「現在可以接」，有人照著開工，做的是一件需求都
   * 還沒確定的事。
   */
  test('掛 unready 標籤就是 triage，下一步是 triage 指令', () => {
    const verdict = verdictOf(issue({ labels: ['needs-info'] }), repo())

    expect(verdict.status).toBe('triage')
    expect(verdict.nextStep).toEqual({ kind: 'command', command: '/triage' })
  })

  /**
   * 守的是「沒掛角色標籤＝還沒評估過」。
   *
   * 壞了會怎樣：新開的票沒人擋它，會直接被畫成 ready。沒被擋不等於已經想清楚要做什麼。
   */
  test('沒掛 ready 標籤也是 triage', () => {
    const verdict = verdictOf(issue({ labels: ['bug'] }), repo())

    expect(verdict.status).toBe('triage')
  })

  /**
   * 守的是「unready 勝過 ready」。
   *
   * 壞了會怎樣：一張被重新打回 `needs-info`、但舊的 `ready-for-agent` 還沒拿掉的票，會因為掛著
   * ready 就被放行。標籤沒清乾淨是常態，這時要以「還沒評估完」為準。
   */
  test('同時掛 unready 與 ready 時仍是 triage', () => {
    const verdict = verdictOf(issue({ labels: ['needs-triage', 'ready-for-agent'] }), repo())

    expect(verdict.status).toBe('triage')
  })

  /**
   * 守的是「掛了 ready 標籤就過閘門」。
   *
   * 壞了會怎樣：triage 這一關變成誰都過不了，整張圖上不會再有可以接的票。
   */
  test('掛 ready 標籤就過閘門', () => {
    const verdict = verdictOf(issue({ labels: ['ready-for-agent'] }), repo())

    expect(verdict.status).toBe('ready')
  })

  /**
   * 守的是「目標 repo 沒在用這套標籤時，不拿 triage 當閘門」。
   *
   * 壞了會怎樣：把工具指向一個沒有這套標籤慣例的 repo，每一張票都會變成待 triage，整張地圖只剩
   * 一種顏色，等於沒有資訊。
   */
  test('repo 沒在用這套標籤時，沒掛標籤也不算 triage', () => {
    const verdict = verdictOf(issue({ labels: [] }), repo({ triaged: false }))

    expect(verdict.status).toBe('ready')
    expect(verdict.nextStep).toEqual({ kind: 'command', command: '/implement' })
  })
})

describe('有人接手', () => {
  /**
   * 守的是「有 assignee 就是有人在做」。
   *
   * 壞了會怎樣：已經有人在做的票會出現在「現在可以接」，兩個人做同一張。
   */
  test('有 assignee 就是 active，下一步寫出是誰', () => {
    const verdict = verdictOf(issue({ assignees: ['gunter'] }), repo())

    expect(verdict.status).toBe('active')
    expect(verdict.nextStep).toEqual({ kind: 'active', who: ['gunter'] })
  })

  /**
   * 守的是「沒有 assignee 但掛了 active 標籤時，`who` 退回標籤名」。
   *
   * 壞了會怎樣：用標籤而不是 assignee 表示「在做」的團隊，票會被畫成沒人接手——那正是這條規則
   * 存在的理由——或是下一步變成一句沒有主詞的話。
   */
  test('掛 active 標籤但沒有 assignee 時，who 退回標籤名', () => {
    const verdict = verdictOf(issue({ labels: ['ready-for-agent', 'in-progress'] }), repo())

    expect(verdict.status).toBe('active')
    expect(verdict.nextStep).toEqual({ kind: 'active', who: ['in-progress'] })
  })

  /**
   * 守的是「有 assignee 時以人為準，標籤只是退路」。
   *
   * 壞了會怎樣：下一步會顯示 `in-progress` 而不是實際在做的人，要找人問進度的人找不到對象。
   */
  test('兩者都有時以 assignee 為準', () => {
    const verdict = verdictOf(
      issue({ labels: ['ready-for-agent', 'in-progress'], assignees: ['gunter', 'mia'] }),
      repo(),
    )

    expect(verdict.nextStep).toEqual({ kind: 'active', who: ['gunter', 'mia'] })
  })

  /**
   * 守的是「有人接手勝過還被擋著」。
   *
   * 壞了會怎樣：有人已經在處理一張前置還沒關完的票（很常見，前置只差收尾），圖上卻畫成 blocked，
   * 於是另一個人也去接同一張。
   */
  test('有人接手時不再算阻擋者', () => {
    const verdict = verdictOf(
      issue({ assignees: ['gunter'], blockedBy: [2] }),
      repo({ open: new Set([2]) }),
    )

    expect(verdict.status).toBe('active')
    expect(verdict.waitingFor).toEqual([2])
  })
})

describe('阻擋者', () => {
  /**
   * 守的是「還開著的阻擋者會把票擋下來」。
   *
   * 壞了會怎樣：這就是整個工具最不能出的錯——被擋住的票畫成可接手，有人去接，開工才發現前置
   * 還沒做。
   */
  test('有還開著的阻擋者就是 blocked，下一步是等那幾張', () => {
    const verdict = verdictOf(issue({ blockedBy: [2, 3] }), repo({ open: new Set([2, 3]) }))

    expect(verdict.status).toBe('blocked')
    expect(verdict.nextStep).toEqual({ kind: 'waitIssues', issues: [2, 3] })
  })

  /**
   * 守的是「已經關掉的阻擋者不算閘門」。
   *
   * 壞了會怎樣：前置全部做完的票會永遠停在 blocked，沒有人知道它其實已經解鎖了。`blockedBy` 要
   * 保留完整清單，頁面靠它畫出「已解鎖的前置」。
   */
  test('阻擋者全關就解鎖，blockedBy 仍保留完整清單', () => {
    const verdict = verdictOf(issue({ blockedBy: [2, 3] }), repo({ open: new Set() }))

    expect(verdict.waitingFor).toEqual([])
    expect(verdict.status).toBe('ready')
  })

  /**
   * 守的是「waitingFor 只留還開著的那幾張」。
   *
   * 壞了會怎樣：下一步會叫人去等一張已經關掉的票。
   */
  test('一半關掉時，waitingFor 只留還開著的', () => {
    const verdict = verdictOf(issue({ blockedBy: [2, 3, 4] }), repo({ open: new Set([3]) }))

    expect(verdict.waitingFor).toEqual([3])
    expect(verdict.nextStep).toEqual({ kind: 'waitIssues', issues: [3] })
  })

  /**
   * 守的是「可以動工的票會給出動工指令」。
   *
   * 壞了會怎樣：地圖最主要的用途就是回答「現在能接哪一張、接了要做什麼」，這條斷了就只剩一張
   * 好看的圖。
   */
  test('沒有阻擋者就是 ready，下一步是動工指令', () => {
    const verdict = verdictOf(issue(), repo())

    expect(verdict.status).toBe('ready')
    expect(verdict.nextStep).toEqual({ kind: 'command', command: '/implement' })
  })

  /**
   * 守的是「要人做的票不會叫人去跑實作指令」。
   *
   * 壞了會怎樣：一張標明需要人判斷的票，圖上會寫「跑 /implement」，於是被交給 agent 去做一件
   * 本來就不該自動做的事。
   */
  test('掛 human 標籤的 ready 票，下一步是人工實作', () => {
    const verdict = verdictOf(issue({ labels: ['ready-for-human'] }), repo())

    expect(verdict.status).toBe('ready')
    expect(verdict.nextStep).toEqual({ kind: 'manual' })
  })
})
