# Desk model seam (Timmy)

One file. One setting. Done.

## 1. Implement `YourModel.infer`

Edit **only** [`src/main/desk/model/your-model.ts`](../src/main/desk/model/your-model.ts).

```ts
async infer(frame: DeskFrame): Promise<DeskModelOutput> {
  // frame = RGB888 or Float32, row-major
  // return { label: "at_desk" | "away" | "uncertain", confidence: 0..1 }
}
```

Keep `id = "custom"`. Call `init()` if you need to load weights. Do not add factory cases, do not import BlazeFace, do not call cloud vision. Uncertain (or confidence below `deskThreshold`) is safe: policy will **not** desk-only-kill on a maybe.

Until you replace the TODO, `infer()` returns `{ label: "uncertain", confidence: 0 }` so a session cannot crash or false-kill.

The frozen contract is `DeskModel` in `src/shared/types.ts` — consume it. Do not invent parallel types.

## 2. Set `deskModelId=custom`

Via `settingsSet` / `deskSetModelId`, or in `settings.json`:

```json
{ "deskModelId": "custom" }
```

Allowed ids: `blazeface` (default, Hyperbloom demo), `custom` (your file), `stub` (always uncertain — gauntlet / safe soak).

## 3. Leave everything else alone

| File | Role |
| --- | --- |
| `src/shared/types.ts` | frozen `DeskModel` / `DeskFrame` / `DeskModelOutput` |
| `src/main/desk/model/factory.ts` | `createDeskModel(id)` / `DeskModelFactory.create` |
| `src/main/desk/model/blazeface-adapter.ts` | existing BlazeFace, wrapped |
| `src/main/desk/model/stub.ts` | always uncertain |
| `src/main/desk/analyze.ts` + `monitor.ts` | call `infer(frame)` only |

`npm run test:desk` — BlazeFace fixtures still pass through the adapter; stub never emits `at_desk` / `away`.
