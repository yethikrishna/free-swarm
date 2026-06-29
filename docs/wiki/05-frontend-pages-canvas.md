# 05 - Frontend Pages & Canvas

Scope: the three primary user surfaces (`Dashboard`, `AgentChat`, `Views`) and
the overlay/modal layer that floats above them. Paths are under
`frontend/src/app/` unless noted.

> Status: assembled from a deep code read. Treat line numbers as accurate at the
> time of writing; re-grep if a file has shifted. Frontend has a ~300 LOC/file
> ceiling, so logic is spread across many small hooks; the composition roots are
> the entry points to start from.

## Dashboard subsystem

The dashboard is a pan/zoom spatial canvas where agent sessions, view-apps,
browsers, and sticky notes are draggable cards. Layout + selection live in
Redux (`dashboardLayoutSlice`); session data in `agentsSlice`.

### Component / hook map

| Layer | File | Role |
|---|---|---|
| Page shell | `pages/Dashboard/Dashboard.tsx` | Wraps `ElementSelectionProvider`, mounts selection overlay + canvas (37 lines, thin) |
| Composition root | `pages/Dashboard/hooks/state/useDashboardController.ts:28` | Wires ~20 hooks, returns the exact prop bag `DashboardCanvas` renders |
| Canvas view | `pages/Dashboard/canvas/DashboardCanvas.tsx:89` | Dot-grid bg, transformed content `<div>`, header/tether/card/overlay layers |
| Card layer | `pages/Dashboard/canvas/DashboardCardLayer.tsx:57` | Maps the four card dicts to `AgentCard`/`DashboardViewCard`/`BrowserCard`/`NoteCard` |
| Tethers | `pages/Dashboard/canvas/TetherLayer.tsx` + `geometry/dashboardTethers.ts` | SVG elbow lines from a source card to a branched child |
| Camera | `pages/Dashboard/hooks/interaction/useCanvasControls.ts:32` | Pan/zoom/inertia/fit; the workhorse (672 lines) |
| Card drag | `pages/Dashboard/hooks/interaction/useCardDrag.ts:22` | Multi-drag + edge-pan during drag |
| Pointer routing | `pages/Dashboard/hooks/interaction/useDashboardInteractions.ts:32` | Routes viewport mouse events between pan, marquee, select |

### Rendering: the transform pipeline

`DashboardCanvas` (`DashboardCanvas.tsx:226-234`) renders all cards inside one
`contentRef` div with `transform: translate(panX,panY) scale(zoom)` and
`transformOrigin: '0 0'`, `willChange: transform`. The dot grid
(`:212-221`) is a separate fixed layer whose `backgroundPosition` tracks
`panX % spacing` / `panY % spacing` so dots appear to scroll with the canvas
without being scaled. Card positions are stored in canvas (untransformed) coords;
the CSS transform does all the visual placement, so card components never read
pan/zoom for layout, only for drag math.

Empty state: when no agents/views/browsers exist, `DashboardEmptyState` renders
instead of the content div (`DashboardCanvas.tsx:223`).

### Camera: `useCanvasControls`

- Zoom is clamped `[0.15, 3.0]` (`useCanvasControls.ts:4-5`); wheel sensitivity
  maps a 1-100 user setting through `sensitivityToMultiplier` (`:11`).
- Wheel handling is **RAF-coalesced** (`:187-226`): trackpads fire ~120Hz, so
  pan/zoom deltas accumulate and flush once per frame in one `setState`. A 140ms
  idle timer (`:220`) toggles `setCanvasInteractionActive` so ResizeObservers /
  streaming reconcilers bail mid-gesture.
- Pinch detection: `ctrlKey || metaKey` on wheel is treated as zoom; plain wheel
  is pan (`:234`, `:286`). Zoom math is centered on the cursor (`:200-203`).
- A `wheel` listener walks ancestors to let scrollable children consume the
  event first, falling through to canvas pan only at the scroll boundary
  (`:241-278`); the per-node scrollable decision is cached in a `WeakMap`
  (`:230`) because `getComputedStyle` walks were the dominant trackpad cost.
- Mouse-drag pan also RAF-coalesces (`flushDrag`, `:355`) with a 5-sample
  velocity ring buffer feeding **inertia** (`startInertia`, `:66`, FRICTION 0.93).
- **Soft boundaries**: `springBackIfNeeded` (`:94`) animates the camera back if
  the viewport drifts >800px beyond content bounds.
- `fitToCards` (`:607`) animates to frame a set of card rects, then schedules a
  **settle pass** at 370ms (`:632`) that recomputes the target and corrects for
  viewport drift (sidebar collapse, route switch). `cancelAnimation` (`:135`)
  must kill `settleTimerRef`, else back-to-back `fitToCards` calls race and the
  first settle overwrites the second target.
- Webview gotcha: `ctrl/meta+wheel` inside an Electron `<webview>` never bubbles
  to the host, so `BrowserCard`'s preload bridge re-emits it as a
  `freeswarm:canvas-wheel-zoom` CustomEvent that the host re-runs (`:305-325`).

### Interaction & state management

- **Selection** (`useDashboardSelection`): single click selects + brings to front;
  shift-click multi-selects; marquee drag draws a selection rect
  (`DashboardCardLayer.tsx:255`). `useDashboardInteractions.ts:93-129` routes
  viewport mousedown: middle/right button => pan; `cmd/ctrl/space` => pan + deselect;
  plain left on empty canvas => marquee.
- **Single vs double click** is disambiguated by a 250ms timer
  (`useDashboardInteractions.ts:60-64`): single-click on an already-expanded agent
  schedules a collapse; the double-click handler clears that timer (`:152`) and
  forces expand + `fitToCards`. Both handlers refuse to blur an active
  input/textarea/contentEditable (`:79-83`) so typing in an embedded card survives
  selection.
- **Card drag** (`useCardDrag.ts`): drag start checks `selection.isSelected` to
  decide multi-drag vs single (`:97-102`). Move dispatches `setMultiDragDelta` /
  `setLiveDragInfo`; only the *dragged* card commits to Redux on its own, the rest
  move via `moveCards` on drag end (`:125-130`). **Edge panning**: when the cursor
  nears a viewport edge (60px `EDGE_ZONE`), a RAF loop pans the canvas up to 8px/frame
  (`:55-84`).
- Pan/zoom is broadcast to dragging cards via a `freeswarm:canvas-pan-changed`
  window event fired from an effect (`useCardDrag.ts:38-40`) so cards re-pin to the
  cursor.
- `getCardRect` (`geometry/getCardRect.ts`) reads rects straight from
  `store.getState().dashboardLayout` at module scope so the callback stays stable
  across renders. `getCanvasState` (`useDashboardController.ts:75`) is the same trick
  for pan/zoom: cards read it on demand during drag math instead of via props.

### Canvas input / output handling

- **Output cards**: a "view" card is keyed by `output_id` and only renders if its
  Output exists in `outputsSlice` (`DashboardCardLayer.tsx:174-176`); `onAddView`
  (`useDashboardCardActions`) places one near current selection.
- **Spawn/branch animation**: `DashboardCardLayer.tsx:92-142` computes a `spawnFrom`
  origin (consumed once, then deleted from `spawnOriginsRef`), an `exitTarget`, and a
  `snapColumn` so a newly branched agent card animates out from its source card's
  right edge and snaps into a column. `glowingAgentCards` drives the tether glow.
- **Measured heights**: expanded agent cards report their real rendered height via
  `onMeasuredHeight` -> `measuredHeightsRef`; tethers and sibling-restack
  (`useSiblingRestack`) use it because Redux only stores the collapsed height.

### Dashboard gotchas

- `useCardDrag.ts:138-140`: `dragStartPanRef` is wired up but `void`-discarded; it
  was for an edge-pan compensation that **never landed**. Dead but harmless.
- `multiDragDelta` is passed only to *selected* cards (`DashboardCardLayer.tsx:158`);
  passing it to all cards broke memo equality and re-rendered every card on every
  mouse-move during multi-drag.
- MUI `Menu`/`Popover` portals dropped over a `<webview>` inside the zoom/pan canvas
  eat clicks (separate compositor layer); see `frontend/CLAUDE.md` Pitfalls.

## AgentChat page

`pages/AgentChat/AgentChat.tsx` is the chat surface, rendered both embedded inside an
expanded `AgentCard` and standalone. Message data lives in `agentsSlice`; live
streaming text in `streamingSlice`; the in-flight send queue and several UI flags are
**local React state**.

### Page flow

- Props (`AgentChat.tsx:242-251`): `sessionId`, `onClose`, `embedded`, `autoFocus`,
  `isGlowing`, `initialContextPaths`, `onBranch`.
- Mount sequence (`:332-379`): REST-hydrate the session's messages **before** opening
  the WebSocket, so `session.messages` is seeded and the WS replay-skip guard does not
  storm re-renders. Warm remounts skip the await and let WS fetch in the background.
- A `session.status` watcher (`:442-483`) drives the queue: on transition to a terminal
  status it dequeues the next message and may flip mode via
  `modesMap[mode].default_next_mode` (`:470-474`).
- A `"draft"`-status welcome session skips WS entirely and renders an onboarding shell.

### Message lifecycle

1. User submits in `ChatInput` -> `handleSend` (`ChatInput.tsx:180-288`):
   serialize editor content, run **block checks** (`:197-232`: hard-block on
   over-length; auto-compact via `POST /api/agents/sessions/{id}/compact` then retry on
   history overflow), then call `onSend` with `{ prompt, images, contextPaths,
   forcedTools, skills }` (`:266-274`).
2. AgentChat `handleSend` (`:846-867`) routes to `messageQueueRef.current` if the agent
   is busy, else dispatches immediately.
3. `dispatchMessage` (`:402-436`) calls `launchAndSendFirstMessage` (draft session) or
   the `sendMessage` thunk (live session).
4. WS events arrive through `shared/ws/WebSocketManager.ts`: a per-rAF coalescer buffers
   frames and flushes them in one `unstable_batchedUpdates` batch (`:138-164`); pong
   bypasses the buffer (`:244`). On open it sends `client:hello` with `last_seq`
   (`:219-234`) so the server replays only missed events.
5. Streaming deltas land in `streamingSlice` keyed by `sessionId`; `StreamingBubble`
   subscribes directly to `streaming.bySession[id]` so token deltas don't re-render the
   whole AgentChat.

### Local-state flags (the reset trap)

| State | Set when | Cleared when |
|---|---|---|
| `messageQueueRef` (`AgentChat.tsx:321`) | agent busy on send | dequeued on terminal status |
| `awaitingResponse` (`:310`) | message dispatched (`:405`) | status terminal (`:481`) |
| `showResumeBubble` (`:309`) | status -> stopped with empty queue (`:465`) | status -> running (`:478`) |

Gotcha (also in `frontend/CLAUDE.md`): `clearSessionMessages` only wipes
`session.messages` in Redux. The Clear handler (`resetWire`, `:1454-1468`) must *also*
reset these three locals, or a stale "thinking" bubble or Resume button survives.

### ChatInput

- **Slash commands** (`ChatInput/hooks/slashCommands.ts:4-26`): `/context`,
  `/compact`, `/clear`; intercepted (return `true`) before send.
- **Draft persistence** (`ChatInput/hooks/draftStore.ts`): a module-level Map +
  debounce timers (200ms, `:13-18`) survive unmount/remount; restored on mount with a
  Windows plain-text vs Mac contentEditable-with-skill-pills split.
- **Modes** rendered in the toolbar; mode change dispatches `updateSessionMode`
  (`ChatInput.tsx:869-872`).
- **Model picker** (`useChatInputModel.ts`): hydrates from `models.byProvider`, falls
  back to `FALLBACK_MODELS`; computes PDF/image support per provider.
- **Attachments**: `useImageAttachments` + `useContextFiles` manage images and context
  files (oversize queue, summarization); `PastePreviewDialog` handles multi-item paste.

### HITL / intervention rendering

`session.pending_approvals` drives `shell/ApprovalBar.tsx`: a `BatchApprovalBar` for
multiple requests else a single `ApprovalBar`. `waiting_approval` status blocks sends.
Request flavors: `AskUserQuestion` (renders a `QuestionForm`), native tools
(Bash/Read/Write/Edit, generic warning-tinted bar), MCP tools (integration metadata +
collapsible details). Sensitive-file requests show `sensitive_label`/`sensitive_why`
plus a "Trust pattern" checkbox persisted to settings. The DynamicIsland surfaces the
`RequestHumanIntervention` tool with distinct yellow-glow styling.

## Views page (apps)

A "View" is an Output record (`shared/state/outputsSlice.ts:9-24`): frontend
`index.html`, optional `backend.py`, an input JSON-Schema, metadata, and a
workspace/session linkage.

### CRUD & routing

`pages/Views/Views.tsx`: list (sorted by recency), `handleNewView` -> `/apps/new`,
`handleEditView` -> `/apps/{id}` (lazy-loads `ViewEditor`), `handleDeleteView` ->
`deleteOutput` thunk with re-sync on failure. The URL `id` param controls editor
open/close via effect (`:35-49`).

### Form schema handling

`InputSchemaForm.tsx` recursively descends the schema (`:163-198`) and dispatches by
type: `enum` -> Select, `boolean` -> Switch, `number`/`integer` -> `NumberField`,
`string` -> `StringField`, `array` -> add/remove item list, `object` -> recurse;
unknown falls back to string (`:200-208`). `inputSchemaFields.tsx` implements the leaf
fields: `NumberField` honors `minimum`/`maximum`/`multipleOf` and clamps on blur;
`StringField` maps `format` (email/url/date/password/textarea) to input types via
`FORMAT_INPUT` and enforces `minLength`/`maxLength`/`pattern`. Defaults + validation
live in `shared/inputSchemaDefaults.ts` (`getDefault`, `validateNode`, `collectIssues`).

### Execution flow (async dialog)

`ViewRunDialog.tsx` is a state-based MUI dialog: collect input via `InputSchemaForm`,
gate "Run" on `collectIssues()` (`:34-41`), then dispatch
`executeOutput({ output_id, input_data, force })` -> `POST /api/outputs/execute`. If the
backend AST validator returns `warnings` (only when `force=false`), the dialog shows a
code-review panel with a "Run Anyway" button that re-dispatches with `force: true`;
success renders the result through `ViewPreview`.

### ViewEditor

Left: embedded `AgentChat` (resizable). Right tabs: Preview (`ViewPreview`), Code (file
tree + CodeMirror-6 `CodeEditor`), Terminal (`TerminalPanel`). File writes debounce a
`PUT /api/outputs/workspace/{wsId}/file/{path}` and reload preview; autosave debounces
1.5s. Preview runs via a Vite dev-server URL; in Electron it uses `<webview>`
(console/IPC forwarded to the terminal, `capturePage` -> thumbnail), in browser an
`<iframe>`. `TerminalPanel` unifies `[FRONTEND]`/`[BACKEND]`/`[RUNTIME]` lines with a
5000-line FIFO cap.

### Views gotchas / stubs

- No support for JSON-Schema `if/then/else`, `$ref`/`definitions`, or
  `additionalProperties` constraints; bad `pattern` regexes are swallowed by a try/catch
  (`inputSchemaFields.tsx:93`), so a malformed schema validates silently.
- `useIframeElementSelector.ts` (click-to-select DOM, html2canvas from CDN) only works
  in iframe mode; the Electron webview path is a known no-op.

## Overlays, search, and modal patterns

### DynamicIsland (`components/overlays/DynamicIsland.tsx`)

A persistent top-center pill with four states (`:377-383`): `idle` (search pill),
`compact` ("N running / M done"), `compact-actionable` (pending non-question approvals,
yellow pulse), `expanded` (full panel; user-initiated or all-questions approval).
Layout/bounce springs at `:61-62`; the session selector (`:192-226`) is identity-cached
to only re-render on `name`/`status`/`dashboard_id`/`pending_approvals` change.
Shortcuts: **Cmd/Ctrl+K** toggles `GlobalSearchPalette` (`:242-252`); **Cmd/Ctrl+L**
clears the focused/active session's messages (`:254-295`). z-index 9999.

### Search palettes

| | GlobalSearchPalette | CardSearchPalette |
|---|---|---|
| File | `components/overlays/GlobalSearchPalette.tsx` | `pages/Dashboard/controls/CardSearchPalette.tsx` |
| Trigger | Cmd/Ctrl+K (always, toggles) | Cmd/Ctrl+F (dashboard active, not in input) |
| Scope | actions, dashboards, sessions, history | agent/view/browser cards on this dashboard |
| Debounce | 120ms history search | none (in-memory) |
| Select | dispatch resume/create | `fitToCards([rect], 1.15, true)` |

z-index: card palette 1000/1001, global palette 1400/1401 (floats over modals).

### DashboardOverlays composition

`pages/Dashboard/canvas/DashboardOverlays.tsx` stacks: `DashboardToolbar` (bottom-center
composer + add view/browser/note), `DirectionHints` (chevrons when focused + zoom>=0.4,
shake on no-neighbor arrow nav), `CanvasControls` (zoom +/-, reset 100%, fit, tidy,
minimap toggle persisted to localStorage, default off), and `CardSearchPalette`.
`Minimap` is a 200x140 SVG of all card rects + a viewport outline, click/drag to pan.

### Modal pattern

All dialogs are **state-based controlled components** (MUI `Dialog`, `open` prop +
`onCancel`/`onConfirm` callbacks); there is no promise-based `useConfirm`/async-dialog
utility in the codebase. Side effects go through Redux thunks.

**Dead stub**: `pages/Dashboard/controls/CloseAgentDialog.tsx` is a complete
close-confirm dialog with **no importers** anywhere; intended UX for closing a running
agent, never integrated.
