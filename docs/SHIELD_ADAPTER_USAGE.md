# Shield Adapter Usage (Investigation Findings)

This document summarizes how to use the Provable Shield wallet adapter correctly, based on the `TransactionOptions` contract, the adapter source, and investigation of external sources. It is intended to fix "failed to parse … credits.record" (and similar) errors when executing transactions with Shield.

---

## 1. TransactionOptions contract (@provablehq/aleo-types)

From `node_modules/@provablehq/aleo-types/dist/index.d.ts`:

- **program**: string — program to execute (e.g. `whisper_market.aleo`)
- **function**: string — function name (e.g. `init`)
- **inputs**: string[] — function inputs; typed as **strings only**. The extension receives this array as-is.
- **fee**: number (optional) — transaction fee
- **recordIndices**: number[] (optional) — "Record indices to use". No further JSDoc in the package.
- **privateFee**: boolean (optional) — whether the fee is private

Implication: `inputs[i]` for record slots must be a string. The type does not specify whether that string must be a record ciphertext, a type name (e.g. `credits.aleo/credits`), or something else. Behavior is determined by the **Shield extension** (`window.shield`), not by the npm adapter.

---

## 2. What the Shield adapter does

From `node_modules/@provablehq/aleo-wallet-adaptor-shield/src/ShieldWalletAdapter.ts`:

- **executeTransaction(options)** simply calls:
  - `this._shieldWallet?.executeTransaction({ ...options, network: this.network })`
- No transformation of `inputs` or `recordIndices`. The adapter is a **pass-through**.
- Real parsing and validation happen inside the **Shield browser extension**; the npm package does not document how the extension uses `recordIndices` or what format `inputs[i]` must have for record slots.

---

## 3. Comparison with Leo adapter

From `node_modules/@provablehq/aleo-wallet-adaptor-leo`:

- Leo does **not** use `recordIndices`. It sends a different shape to the Leo wallet:
  - `transitions: [{ program, functionName, inputs }]`
- So the `recordIndices` contract is **specific to Shield** (and possibly other wallets that accept `TransactionOptions` as-is from Provable).

---

## 4. Investigation results (steps 1–3b)

### 4.1 Aleo dev toolkit repo (ProvableHQ/aleo-dev-toolkit)

- Repo structure: `packages/aleo-wallet-adaptor/wallets/shield`, `examples/react-app`, `docs/`.
- README points to `examples/react-app` and wallet adapter README; no in-repo documentation found that explains `recordIndices` or the exact format of `inputs` for record slots.
- Raw fetches to example/demo source timed out; no concrete `TransactionOptions` examples extracted from the toolkit repo in this pass.

### 4.2 Types and README in node_modules

- **aleo-types**: Only the comment "Record indices to use" for `recordIndices`; no specification of semantics.
- **aleo-wallet-adaptor-shield**: README shows basic usage (`new ShieldWalletAdapter()`, live demo URL). No description of `executeTransaction` payload or record handling.
- **aleo-wallet-standard**: `ExecuteFeature` defines `executeTransaction(options: TransactionOptions)` with no extra contract.

Conclusion: **No further written contract** in the installed packages for how Shield uses `recordIndices` or what to put in `inputs` for record parameters.

### 4.3 Live demo and web search

- **Demo**: https://aleo-dev-toolkit-react-app.vercel.app/ (from Shield adapter README). No payload inspection was done in this pass; recommended to open demo, connect Shield, trigger a transaction that spends a record, and capture the payload (e.g. via devtools).
- **Web search**: General Aleo docs (credits record structure, execute transactions, microcredits) were found. No Shield-specific documentation for `executeTransaction` or `recordIndices` was found.

### 4.4 GitHub search (other repositories)

- Searches for: `executeTransaction` + `recordIndices`, `ShieldWalletAdapter` + `executeTransaction`, `aleo-wallet-adaptor-shield` + `inputs`, `credits.aleo` + `recordIndices`.
- **Result**: No concrete open-source examples found in other repos that show a full, working `TransactionOptions` for Shield with record inputs. Leo Wallet Docs (docs.leo.app) describe a **different** API (demox-labs: `AleoTransaction` with `address`, `chainId`, `fee`, `feePrivate`, `transitions`) that does not use `recordIndices`.

---

## 5. Local experiment procedure (step 4)

To determine which combination Shield accepts, run the following in this app for **one** transition that takes a credits record (e.g. `init` in `whisper_market.aleo`):

1. **Ciphertext only, no recordIndices**
   - Build `TransactionOptions` with `inputs` containing the **record ciphertext string** (from `requestRecords` → `record.recordCiphertext`) at the correct index.
   - Omit `recordIndices` (or set `recordIndices: undefined`).
   - Call Shield `executeTransaction(options)`.
   - Document: success or exact error message (e.g. "Failed to parse input #5 …").

2. **Ciphertext + recordIndices**
   - Same as (1) but set `recordIndices: [<recordIndex>]` (e.g. `[5]` for `init`).
   - Document: success or error.

3. **Placeholder at record index + recordIndices**
   - Put a type placeholder (e.g. `credits.aleo/credits`) at the record index in `inputs`, and set `recordIndices: [<recordIndex>]`.
   - Document: success or error.

4. **Vary one thing at a time**
   - If the demo or any future doc suggests a fee unit (credits vs microcredits), repeat the winning combination with the other unit and document the result.

**Input indexing (this app):** We use 0-based indices. For `init(initial_liquidity, bond_amount, fee_bps, metadata_hash, salt, credit_record)`, the record is at **index 5**. If an error says "input #5", it may be 1-based (meaning salt) or 0-based (meaning record).

---

## 6. Recommended usage (once experiments confirm)

- **When the user has records:** Prefer passing the **record object** at the record index and using `createTransactionOptions(..., [recordIndex])` so that `recordToInputForAdapter` extracts the **ciphertext string** and the options object sent to the wallet **does not** include `recordIndices`. That way Shield receives a concrete ciphertext at that index and (if the extension does not overwrite it) should parse it correctly.
- **When the user does not have records:** Use the intent path (placeholder + `recordIndices`) and let the wallet handle the failure (e.g. prompt or error).

**Current app behavior:** In `src/lib/aleo/rpc.ts`, for Shield with records we pass the record object at index 5 and use `createTransactionOptions`, which does not add `recordIndices` to the returned options. For Shield without records we use `createIntentTransactionOptions`, which adds `recordIndices`. If all Shield transactions still fail with parse errors on record inputs, the next step is to run the local experiments above and, if needed, open an issue or contact Provable/Shield with the exact payload (inputs + recordIndices) and error message.

---

## 7. Open questions

- **recordIndices semantics:** Does Shield treat `recordIndices` as "replace these input slots with records chosen by the user" (and overwrite our value), or as a hint for something else?
- **Fee unit:** Is `fee` in TransactionOptions in credits or microcredits? (This app passes microcredits from `getFeeForFunction`.)
- **Error indexing:** Are Shield error message indices 0-based or 1-based?
- **Other transitions:** Same record-passing strategy may be needed for deposit, open_position, swap, etc.; apply the same pattern (ciphertext at record index, no recordIndices when we have the record) and validate with experiments if needed.

---

## 8. Optional: experiment result table

After running the local experiments, fill in:

| Transition | Inputs length | Record index | recordIndices | Result (success / error message) |
|------------|---------------|--------------|---------------|----------------------------------|
| init       | 6             | 5            | no            | …                                |
| init       | 6             | 5            | yes [5]       | …                                |
| init       | 6             | 5            | yes [5], placeholder at 5 | …                    |

(Add rows for other transitions as needed.)
