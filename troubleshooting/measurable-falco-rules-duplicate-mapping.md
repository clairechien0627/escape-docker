# `measurableFalcoRules` 未去重，導致 `rule_coverage`/`false_positive_rate` 分母失真、`false_positive_rules` 出現重複項目

> **日期：** 2026-06-14

## 1. 緣由

Phase 8 對 15 個場景各跑一次 `POST /api/lab/baseline-runs`（靜置 20 秒、
不執行 exploit，收集 Falco 告警以計算 `false_positive_rate`）後，檢視
`GET /api/lab/analytics/detection-matrix` 的結果，發現兩個場景的
`false_positive_rules` 出現**重複項目**：

```
room0 | fp_rules: ["Baseline Read Of Motd Or Hint File","Baseline Read Of Motd Or Hint File"] | fp_rate: 1
final | fp_rules: ["Unexpected Child Process In Container Via Docker Exec","Unexpected Child Process In Container Via Docker Exec"] | fp_rate: 0.6666666666666666
```

`final` 的 `false_positive_rate` 是 `2/3`，但實際上只有**一條** Falco
規則（`Unexpected Child Process In Container Via Docker Exec`）在 baseline
期間誤報，分母 3 也包含了重複計入的同一條規則。

## 2. 根因

`lab-api/lib/app.js` 的 `FALCO_RULE_REF_MAP` 是 `falco_rule_refs`（scenario
JSON 裡語意化的攻擊手法代號）→ Falco 規則名稱的對照表，**多對一**是常見且
合理的設計（例如 `read_etc_motd`／`read_hint_file` 都對應到同一條
`Baseline Read Of Motd Or Hint File`；`exec_create_in_other_container`／
`unexpected_child_process_in_container` 都對應到
`Unexpected Child Process In Container Via Docker Exec`）：

```js
const FALCO_RULE_REF_MAP = {
  read_etc_motd: 'Baseline Read Of Motd Or Hint File',
  read_hint_file: 'Baseline Read Of Motd Or Hint File',
  ...
  exec_create_in_other_container: 'Unexpected Child Process In Container Via Docker Exec',
  unexpected_child_process_in_container: 'Unexpected Child Process In Container Via Docker Exec',
  ...
};
```

但 `measurableFalcoRules()`（修復前）直接 `map` + `filter`，**沒有去重**：

```js
function measurableFalcoRules(falcoRuleRefs) {
  return (falcoRuleRefs || [])
    .map((ref) => FALCO_RULE_REF_MAP[ref])
    .filter((ruleName) => ruleName && !DISABLED_FALCO_RULES.has(ruleName));
}
```

- `room0.falco_rule_refs = ["read_etc_motd","read_hint_file"]`
  → `measurable = ['Baseline Read Of Motd Or Hint File', 'Baseline Read Of Motd Or Hint File']`（長度 2，實際只有 1 條規則）
- `final.falco_rule_refs = ["docker_sock_exec_api","exec_create_in_other_container","unexpected_child_process_in_container"]`
  → `measurable` 長度 3，但其中 2 個都對應到
  `Unexpected Child Process In Container Via Docker Exec`，實際只有 2 條
  不重複的規則

`detection-matrix` 的 `false_positive_rules`/`false_positive_rate` 計算：

```js
const falsePositiveRules = measurable.filter((ruleName) => e.baselineTriggeredRuleNames.has(ruleName));
...
false_positive_rate: e.baselineRuns && measurable.length ? falsePositiveRules.length / measurable.length : null,
```

`baselineTriggeredRuleNames` 是 `Set`（依規則名稱去重），所以只要該規則名稱
觸發過，`measurable` 裡所有重複項目都會通過 `.filter()`，導致：

1. `false_positive_rules` 陣列出現重複項目（前端會原樣顯示）
2. `false_positive_rate` 的分子分母同時被重複計入，當「重複規則是否誤報」
   與「其他不重複規則是否誤報」狀態不同時，比例會失真（`final` 案例：
   2/3 而非真實的 1/2）

`rule_coverage`（既有欄位，沿用同一個 `measurable`）也有同樣的分母失真
風險，只是這次 15 個場景剛好都沒有出現「重複規則觸發、其他規則未觸發」這種
會讓 `rule_coverage` 數字本身偏離正確值的組合，所以先前未被注意到——但
`triggered_rules` 欄位本身有額外用 `triggeredRulesUnique = [...new
Set(triggeredRules)]` 去重來掩蓋顯示層的重複，`false_positive_rules`（Phase
8 新增）沒有套用同樣的處理，問題才在這次顯現。

## 3. 修復

在 `measurableFalcoRules()` 的回傳值做 `[...new Set(...)]` 去重，從根源
解決，連帶修正 `rule_coverage`、`triggered_rules`、
`false_positive_rules`、`false_positive_rate` 四個衍生欄位（後三者的分母
都是 `measurable.length`）：

```js
function measurableFalcoRules(falcoRuleRefs) {
  const ruleNames = (falcoRuleRefs || [])
    .map((ref) => FALCO_RULE_REF_MAP[ref])
    .filter((ruleName) => ruleName && !DISABLED_FALCO_RULES.has(ruleName));
  return [...new Set(ruleNames)];
}
```

## 4. 驗證

- 新增測試 `GET /api/lab/analytics/detection-matrix deduplicates
  falco_rule_refs that map to the same Falco rule`（`lab-api/test/app.test.js`）：
  自訂一個 `falco_rule_refs: ['read_etc_motd', 'read_hint_file']`
  的場景（對應 room0 的真實設定），驗證 `rule_coverage === 1`、
  `triggered_rules`/`false_positive_rules` 皆為單一元素陣列、
  `false_positive_rate === 1`
- `node --test`：47/47 通過
- `docker compose build lab-api && docker compose up -d lab-api` 後，
  重新呼叫 `GET /api/lab/analytics/detection-matrix`：
  - `room0.false_positive_rules` 變為 `["Baseline Read Of Motd Or Hint
    File"]`（單一項目），`false_positive_rate` 維持 `1`
  - `final.false_positive_rules` 變為 `["Unexpected Child Process In
    Container Via Docker Exec"]`（單一項目），`false_positive_rate` 由
    `0.667` 修正為 `0.5`
  - 其餘 13 個場景的 `rule_coverage`/`false_positive_rate` 數值不變
    （原本就沒有重複映射）

## 5. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `lab-api/lib/app.js` | `measurableFalcoRules()` 回傳值改為 `[...new Set(...)]` 去重 |
| `lab-api/test/app.test.js` | `buildApp()` 新增 `overrides.scenarios` 支援；新增去重驗證測試 |
