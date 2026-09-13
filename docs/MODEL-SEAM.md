# Desk model seam (Timmy)

One factory. One setting. Three ids.

> **`custom` is not empty.** `src/main/desk/model/your-model.ts` is 758 lines of
> shipped, trained classifier — BlazeFace over four crops + a MobileNetV2 scene
> vector + hand-crafted descriptors → a trained 64-32 MLP head, 95.16% held-out
> 3-way accuracy, weights committed at `model/weights/desk-head.json`. Full
> write-up: [docs/CUSTOM-MODEL.md](CUSTOM-MODEL.md). Editing that file in place
> **replaces the shipped model**. Pick a route in §1 before you type.

## 0. What occupies the seam today

| `deskModelId` | File | What it is |
| --- | --- | --- |
| `blazeface` (default) | `model/blazeface-adapter.ts` | On-device MediaPipe BlazeFace + occlusion heuristics. The Hyperbloom demo path |
| `custom` | `model/your-model.ts` | **Shipped trained head** (see above). Not a stub |
| `stub` | `model/stub.ts` | Always `{ uncertain, 0 }` — gauntlet / safe soak |

The frozen contract is `DeskModel` / `DeskFrame` / `DeskModelOutput` in
`src/shared/types.ts` — consume it. Do not invent parallel types.

```ts
async infer(frame: DeskFrame): Promise<DeskModelOutput> {
  // frame = RGB888 row-major, width/height attached
  // return { label: "at_desk" | "away" | "uncertain", confidence: 0..1 }
}
```

Uncertain (or confidence below `deskThreshold`) is always safe: policy will
**not** desk-only-kill on a maybe. `YourModel` leans on that — if its head
weights are missing or unparseable it returns `{ uncertain, 0 }` with
`debug.reason = "custom-head-weights-missing"` and retries the load on the next
`infer`, so a bad weights file cannot crash or false-kill a session
(`src/main/desk/model/your-model.test.ts` asserts both halves).

## 1. Two routes for your own model

**(a) Replace the shipped head — destructive.** Overwrite `infer()` in
[`src/main/desk/model/your-model.ts`](../src/main/desk/model/your-model.ts),
keep `id = "custom"`, call `init()` if you need to load weights. You lose the
95.16% model, and `npm run test:desk` fails its `trained custom model calls the
face fixture at_desk with real confidence` assertion until yours clears the same
bar (`at_desk`, confidence > 0.5, on `src/main/desk/fixtures/face.jpg`). Fine
for a fork; not fine if the shipped numbers should keep meaning anything.

**(b) Add a fourth id — non-destructive, costs a contract amendment.**
`DeskModelId` is `"stub" | "blazeface" | "custom"` inside the frozen Types
fence. A new id means, in one commit: the union in `src/shared/types.ts`, the
identical edit to the Types fence in [docs/CONTRACTS.md](CONTRACTS.md) (`npm run
check:contracts` byte-compares the two), the `isDeskModelId` guard and a `case`
in `model/factory.ts`, plus your new file next to the other three. Nothing else
moves.

Either way: do not import BlazeFace directly (go through the exported adapter,
as `your-model.ts` does, so the weights load once), and do not call cloud vision.

## 2. Set the id

Via `settingsSet` / `deskSetModelId`, or in `settings.json`:

```json
{ "deskModelId": "custom" }
```

## 3. Leave everything else alone

| File | Role |
| --- | --- |
| `src/shared/types.ts` | frozen `DeskModel` / `DeskFrame` / `DeskModelOutput` / `DeskModelId` |
| `src/main/desk/model/factory.ts` | `createDeskModel(id)` / `DeskModelFactory.create` / `getSharedDeskModel` |
| `src/main/desk/model/blazeface-adapter.ts` | existing BlazeFace, wrapped |
| `src/main/desk/model/stub.ts` | always uncertain |
| `src/main/desk/analyze.ts` + `monitor.ts` | call `infer(frame)` only |

`npm run test:desk` — BlazeFace fixtures still pass through the adapter, the
trained custom head still calls `face.jpg` `at_desk`, and stub never emits
`at_desk` / `away`.
