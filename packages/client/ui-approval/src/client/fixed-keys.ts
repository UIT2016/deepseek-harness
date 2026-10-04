/** Window-level Enter and Escape routing to the approval panel on screen. */
import type { Shortcuts, ShortcutFixedInput } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ApprovalDecision, PendingApproval } from './contract/slots.ts'

/**
 * Answer the pending request rendered by the visible approval panel.
 *
 * The panel's own focused handler owns keys raised inside it. Every other focus
 * position reaches this observer: the takeover hides the composer it replaces,
 * which drops focus to the document body, so a user who never clicked into the
 * panel would otherwise answer with the pointer only. A terminal or editable
 * keyboard owner, an open dialog or menu, Enter on a control, and ambiguous
 * multiple panels all keep their own behavior.
 * @param pendings - live requests keyed by the panel identity that renders them.
 * @param shortcuts - window keyboard arbitration and fixed-key reservations.
 * @returns disposer releasing the fixed-input subscription.
 */
export function installApprovalKeys(
  pendings: ReadonlyMap<string, PendingApproval>,
  shortcuts: Shortcuts,
): () => void {
  return shortcuts.observeFixedInput((input: ShortcutFixedInput) => {
    if (input.type === 'reset') return
    const { gesture, context } = input
    const target = context.target
    if (target === null || context.modal !== null || context.region !== 'page'
      || gesture.repeat || gesture.composing
      || gesture.defaultPrevented || gesture.control || gesture.alt || gesture.shift || gesture.meta) return
    const decision: ApprovalDecision | undefined = gesture.code === 'Enter'
      ? 'allowed-once'
      : gesture.code === 'Escape' ? 'rejected' : undefined
    if (decision === undefined) return
    if (target.closest('[data-approval-key]') !== null) return
    const panels = document.querySelectorAll<HTMLElement>('[data-approval-key]')
    const [panel] = panels
    // Two visible takeovers are ambiguous; the one containing the target
    // returned above, and its own handler answers.
    if (panel === undefined || panels.length !== 1) return
    // Enter on a control is that control's activation.
    if (gesture.code === 'Enter' && target.closest('button, a[href], [role="button"]') !== null) return
    const pending = pendings.get(panel.dataset.approvalKey as string)
    if (pending === undefined || !pending.answerable) return
    input.consume()
    void pending.answer(decision).catch((error: unknown) => {
      console.error('ui-approval: keyboard answer failed', error)
    })
  })
}
