---
description: "Browser approval UI that answers Host permission requests through the scoped interaction path."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-approval

English | [中文](README.zh.md)

## Summary

Browser approval presentation over the Agent-scoped Remote Event waterfall. The plugin publishes each pending request through `ctx.uiSession`, takes over the Conversation composer, optionally renders correlated Tool detail, and returns the user's decision to the waiting Host request. Use it when a browser must collect approval for a waiting Host operation.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

Enter approves and Esc rejects the visible request from anywhere in the window, including while focus stays in the draft the takeover hides. Keys raised inside the panel stay with its own focused handler; a usable editable outside the takeover keeps all its keys, and Enter on a focused control keeps the control's activation. The mounted plugin reserves both keys against editable shortcuts. Several visible panels, or none, answer nothing. Keyboard and pointer actions share one pending-request lock; a withdrawn or replaced request cannot accept another answer, and an earlier failed answer cannot unlock its replacement.

<a id="model-experience"></a>
## Model Experience

None, as this package presents approval requests in the browser and registers nothing model-facing.

#### KV Cache effect

None; approval request and response rendering does not alter a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The panel exposes transient decisions only** — it supports allow-once and reject; persistent permission policy remains owned by Host-side approval packages. Requester-supplied localized presentation copy follows the UI language without changing the audit reason or translating model-generated text.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Registries own and observe the Remote listener and temporary Slot entry.
