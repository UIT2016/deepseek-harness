/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort row pair (label + current value + a right chevron), the
 * model row drilling into the provider-grouped list over the shared
 * directory. The effort row drills into a slider over the exact model's
 * adapter-owned levels in their advertised order: the filled track and its
 * glow scale with the selected level, so a stronger effort reads as a
 * stronger signal. The trigger (313:14108's ToggleButton) shows both: model
 * name + effort in the caption tone. Data and submission ride the SAME
 * per-session ModelDirectory as the /model popup; exact-model reasoning
 * metadata and the selected effort come from the Host rather than a
 * client-owned vocabulary. A rejected selection announces through the shared
 * transient Toast anchored to the composer card; the in-menu strip with Retry
 * remains the catalog-load surface.
 */
import {
  useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type ChangeEvent, type CSSProperties, type KeyboardEvent, type FocusEvent,
} from 'react'
import clsx from 'clsx'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconWarningOutline16, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import css from './ModelSelect.module.css'

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort'

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
export function ModelSelect(
  { locked, available, directory, load, select, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  // Dragging the effort slider previews a stop locally so the thumb, the
  // filled track and its glow follow the pointer before the Host round trip
  // lands. The store stays the authority: the preview drops itself as soon as
  // the committed level arrives, and a model switch re-advertises the levels.
  const [preview, setPreview] = useState<number | null>(null)
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])
  const id = useId()

  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [state.groups])
  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  // The adapter advertises its levels weakest first, so a level's position in
  // that list is the slider stop and its normalized value the glow intensity.
  const levels = reasoning?.efforts ?? []
  const selectedLevelIndex = effectiveEffort === undefined
    ? -1
    : levels.findIndex(level => level.id === effectiveEffort)
  const previewIndex = preview !== null
    && preview < levels.length
    && levels[preview]?.id !== effectiveEffort
    ? preview
    : null
  const sliderIndex = previewIndex ?? (selectedLevelIndex < 0 ? 0 : selectedLevelIndex)
  const sliderIntensity = levels.length > 1 ? sliderIndex / (levels.length - 1) : 0
  // The provider default has no stop of its own: it keeps the store label and
  // shows no level description until the user picks a level.
  const shownLevel = previewIndex !== null || selectedLevelIndex >= 0 ? levels[sliderIndex] : undefined
  const shownLabel = shownLevel?.name ?? effortLabel
  const showProviderDefault = reasoning !== undefined && reasoning.defaultEffort === undefined
  const busy = state.status === 'selecting'

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  if (!available) return null

  const show = (): void => {
    setPane('root')
    setPreview(null)
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    setPreview(null)
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
    }
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  // The effort pane stays open across a change: the slider is a continuous
  // control, so closing on the first committed stop would fight the drag.
  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      setPreview(null)
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    void select(selection).then((accepted) => {
      if (accepted) return
      setPreview(null)
      const message = directory.getSnapshot().error
      if (message !== null) {
        toastSeq.current += 1
        setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
      }
    })
  }

  const previewEffort = (event: ChangeEvent<HTMLInputElement>): void => {
    setPreview(Number(event.target.value))
  }

  // A pointer release or key release ends one adjustment; the committed level
  // is whatever the preview holds, and a release without a preview is a no-op.
  const commitEffort = (): void => {
    if (previewIndex === null) return
    const level = levels[previewIndex]
    if (level !== undefined) chooseEffort(level.id)
  }

  const waiting = state.current === null && state.status === 'loading'
  const modelLabel = waiting
    ? t('trigger.loading')
    : currentChoice?.model.name
      ?? (state.current === null ? t('trigger.fallback') : `${state.current.provider}/${state.current.model}`)
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = waiting
    ? t('trigger.loading')
    : state.current === null
      ? t('trigger.selectAria')
      : effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
          } else {
            show()
          }
        }}
      >
        <span className={css.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={css.menu}
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('model') }}>
                <span className={css.cellLabel}>{t('menu.model')}</span>
                <span className={css.cellValue}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.cellChevron} />
              </button>
              {reasoning !== undefined && (
                <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('effort') }}>
                  <span className={css.cellLabel}>{t('menu.effort')}</span>
                  <span className={css.cellValue}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.cellChevron} />
                </button>
              )}
            </>
          )}

          {pane === 'model' && (
            <>
              {state.status === 'loading' && (
                <div className={css.status}>{t('status.loading')}</div>
              )}
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              )}
              {state.failures.map(failure => (
                <div className={css.warning} key={failure.id}>
                  <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              ))}
              <div className={clsx(css.groups, 'scrollable')}>
                {state.groups.map((group) => {
                  const headingId = `${id}-${group.id}`
                  return (
                    <section role="group" aria-labelledby={headingId} className={css.group} key={group.id}>
                      <div className={css.groupTitle} id={headingId}>{group.name}</div>
                      {group.models.map((model) => {
                        const selected = state.current?.provider === group.id && state.current.model === model.id
                        return (
                          <button
                            ref={itemRef()}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={clsx(css.option, selected && css.selected)}
                            key={model.id}
                            title={model.name}
                            disabled={busy}
                            onClick={() => { choose({ provider: group.id, model: model.id }) }}
                          >
                            <span className={css.optionCopy}>
                              <span className={css.modelName}>{model.name}</span>
                            </span>
                            <span className={css.check}>
                              {selected ? <IconCheckOutline16 /> : null}
                            </span>
                          </button>
                        )
                      })}
                    </section>
                  )
                })}
              </div>
              {state.status === 'ready' && choices.length === 0 && (
                <div className={css.empty}>{t('empty.models')}</div>
              )}
            </>
          )}

          {pane === 'effort' && (
            <>
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
                </div>
              )}
              {levels.length === 0
                ? <div className={css.empty}>{t('empty.efforts')}</div>
                : (
                  <div className={css.effortPane}>
                    {/* A single advertised level has no range to slide: it stays
                        a selectable row, which is also the only way to pick it
                        when the adapter declares no default. */}
                    {levels.length === 1
                      ? levels.map(level => (
                        <button
                          ref={itemRef()}
                          type="button"
                          role="menuitemradio"
                          aria-checked={effectiveEffort === level.id}
                          className={clsx(css.option, effectiveEffort === level.id && css.selected)}
                          key={level.id}
                          disabled={busy}
                          onClick={() => { chooseEffort(level.id) }}
                        >
                          <span className={css.optionCopy}>
                            <span className={css.modelName}>{level.name}</span>
                          </span>
                          <span className={css.check}>
                            {effectiveEffort === level.id ? <IconCheckOutline16 /> : null}
                          </span>
                        </button>
                      ))
                      : (
                        <>
                          <div className={css.effortHead}>{shownLabel}</div>
                          <div
                            className={css.sliderWrap}
                            style={{
                              '--dsh-effort-progress': `${Math.round(sliderIntensity * 1000) / 10}%`,
                              '--dsh-effort-level': sliderIntensity,
                            } as CSSProperties}
                          >
                            <div className={css.sliderRow}>
                              <div className={css.sliderTrack} aria-hidden="true">
                                <div className={css.sliderFill} />
                              </div>
                              <input
                                ref={itemRef()}
                                type="range"
                                className={css.slider}
                                min={0}
                                max={levels.length - 1}
                                step={1}
                                value={sliderIndex}
                                aria-label={t('menu.effort')}
                                aria-valuetext={shownLabel}
                                disabled={busy}
                                onChange={previewEffort}
                                onPointerUp={commitEffort}
                                onKeyUp={commitEffort}
                              />
                            </div>
                            <div className={css.ticks} aria-hidden="true">
                              {levels.map((level, index) => (
                                <span
                                  key={level.id}
                                  className={clsx(css.tick, index === sliderIndex && css.tickActive)}
                                >
                                  {level.name}
                                </span>
                              ))}
                            </div>
                          </div>
                          {shownLevel?.description !== undefined && (
                            <p className={css.effortDescription}>{shownLevel.description}</p>
                          )}
                        </>
                      )}
                    {showProviderDefault && (
                      <button
                        ref={itemRef()}
                        type="button"
                        role="menuitemradio"
                        aria-checked={effectiveEffort === undefined}
                        className={clsx(css.defaultChip, effectiveEffort === undefined && css.defaultChipActive)}
                        disabled={busy}
                        onClick={() => { chooseEffort(undefined) }}
                      >
                        {t('effort.providerDefault')}
                      </button>
                    )}
                  </div>
                )}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
