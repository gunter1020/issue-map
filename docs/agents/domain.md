# 領域文件

工程相關 skill 探索程式碼庫時，依本規範取用本專案的領域文件。

## 動手探索前先讀

- 根目錄的 **`CONTEXT.md`**，或
- 若根目錄存在 **`CONTEXT-MAP.md`**：它會指向各領域邊界（context）各自的 `CONTEXT.md`，請讀與當下主題相關的檔案。
- **`docs/adr/`**：閱讀與即將動手區域相關的 ADR；若為多邊界專案，也一併檢查 `src/<context>/docs/adr/` 底下的區域性決定。

若上述檔案不存在，**靜默繼續即可**，不必特別標記缺少或預先建議建立。`/domain-modeling` skill（透過 `/grill-with-docs` 與 `/improve-codebase-architecture` 進入）會在詞彙或架構決定真的拍板時按需建立。

## 檔案結構

單一領域邊界專案（多數專案）：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多領域邊界專案（根目錄有 `CONTEXT-MAP.md`）：

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 全系統層級決定
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 該邊界專屬決定
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 沿用詞彙表的用語

當你的輸出需要指稱領域概念（例如票標題、重構提案、假設、測試名稱），請使用 `CONTEXT.md` 定義的詞彙，不要漂成詞彙表明確避免的同義詞。

如果需要的概念尚未出現在詞彙表裡，代表兩個可能：你正在發明這個專案不使用的說法（先重新思考），或是真的存在詞彙缺口（記下來交給 `/domain-modeling`）。

## 標出與 ADR 的衝突

若你的結論與既有 ADR 矛盾，請明確點出而不是默默覆寫：

> _與 ADR-0007（event-sourced orders）衝突，但值得重開討論的原因是…_
