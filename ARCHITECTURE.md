# piper-draw architecture

Read this before grepping. It is the navigation map agents and contributors
should rely on instead of loading the whole `gui/src/` tree into context.

## Top-level data flow (how a click becomes a block)

```
            user input (mouse / keyboard)
                       │
                       ▼
   components/*  ──────►  hooks (App.tsx orchestrates pointer + keybind)
   (R3F renderers,        │
    Toolbar, panels)      ▼
                  stores/blockStore.ts
                  (Zustand: blocks Map, selection, build mode,
                   group state, undo stack — single source of truth)
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   components/    utils/validate   utils/dae{Export,Import}
   re-render      utils/zx          utils/sceneShare
                  utils/flows       (read-only consumers of state)
```

A click in the 3D scene fires through a component handler, which calls a
mutator on `blockStore`. The store applies the mutation, pushes an
`UndoCommand` onto its history, and notifies subscribers; React re-renders
the affected components on the next frame.

## Module map

| Directory             | Owns                                                                |
|-----------------------|---------------------------------------------------------------------|
| `gui/src/stores/`     | Zustand stores. `blockStore` is the universe; `groupSelectors`, `keybindStore`, `locateStore`, `validationStore` are focused. |
| `gui/src/types/`      | Shared types. `index.ts` is currently mixed types+logic; logic is migrating out into focused utility files. |
| `gui/src/utils/`      | Pure helpers: geometry, validation, ZX graph derivation, DAE im/export, scene share, templates, drag/snap math. No React, no Zustand subscriptions. |
| `gui/src/components/` | React + R3F. `BlockInstances` renders the scene; `Toolbar`/`HelpPanel`/`ZXPanel`/`FlowsPanel` are UI panels; the rest are overlays and ghost previews. |
| `gui/src/hooks/`      | Reusable hooks (floating panels, pulse animation, viewport fit). |
| `gui/src/App.tsx`     | Top-level layout, keybind dispatch, pointer routing. |

### Boundaries (enforced manually today, lint-enforced after PR 9 / E4)

- `utils/*` MUST NOT import from `stores/*`. Helpers receive state by argument.
- `types/*` is for type aliases + barrel exports only — no runtime logic
  (in flight; see `types/index.ts` split, plan PR 8).
- `components/*` reach into `stores/*` via the hook surface. Direct
  `getState()` is allowed only inside event handlers, with an inline comment
  justifying it.

## Files NOT to grow

Hot files; every meaningful PR pulls them into context. Hold the line:

| File                                  | Current LOC | Target LOC |
|---------------------------------------|------------:|-----------:|
| `gui/src/stores/blockStore.ts`        |       ~4180 |   < 2,000 |
| `gui/src/types/index.ts`              |       ~1751 |   < 500   |
| `gui/src/components/Toolbar.tsx`      |       ~1713 |   < 600   |
| `gui/src/App.tsx`                     |       ~1314 |   < 600   |
| `gui/src/components/ZXPanel.tsx`      |        ~964 |   < 600   |
| `gui/src/components/FlowsPanel.tsx`   |        ~755 |   < 600   |

Targets are tracked by the scheduled weekly /retro; ESLint `max-lines: 600`
enforces the cap going forward (existing offenders grandfathered until their
splits ship).

## Where to add new things

```
new code
  ├── React component / overlay?              → gui/src/components/<Name>.tsx
  ├── Pure helper (geometry, validation, …)?  → gui/src/utils/<concern>.ts
  ├── New piece of UI state with its own
  │   lifecycle (toast bus, modal stack, …)?  → gui/src/stores/<concern>Store.ts
  ├── New shared TYPE (no logic)?             → gui/src/types/<concern>.ts
  ├── Mutation of Block / blocks Map?         → gui/src/stores/blockStore.ts
  │                                              (must spread the original Block)
  └── Reusable hook?                          → gui/src/hooks/<useName>.ts
```

If your change does not cleanly fit one of these slots, that is a signal —
discuss the boundary before adding to a hot file.

## Block construction invariant

When mutating an existing `Block`, spread the original:

```ts
blocks.set(b.pos, { ...b, ...changes });   // correct
blocks.set(pos, { pos, type: b.type });    // drops faceColors, groupId, …
```

Bare `{ pos, type }` is correct ONLY for genuine new-block creation paths
where no existing block needs preserving. See learning
`paint-faceColors-lost-on-bulk-add-and-clipboard` for the 7 documented
mutation sites and `piper-draw-block-mutator-spread-audit` for the audit
pattern.

## Updating this document

If your PR moves a helper between `utils/` ↔ `stores/`, splits a hot file,
adds a new directory under `gui/src/`, or changes what a store owns — update
this document in the same PR. CI fails PRs that touch `gui/src/stores/` or
`gui/src/utils/` without touching `ARCHITECTURE.md`. Override with
`[arch-noop]` in the commit message for genuinely no-op changes (typo fix,
test-only edit).
