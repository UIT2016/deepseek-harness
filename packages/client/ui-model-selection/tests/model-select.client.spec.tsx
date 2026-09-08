// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        description: 'Fast catalog description',
        reasoning,
      }],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

afterEach(cleanup)

/** The effort slider's live value: jsdom exposes it as a property, not an attribute. */
function sliderValue(): string {
  const slider = screen.getByRole('slider', { name: '推理等级' })
  if (!(slider instanceof HTMLInputElement)) throw new Error('effort slider is not a range input')
  return slider.value
}

describe('ModelSelect reasoning effort', () => {
  it('renders the advertised levels as a slider and submits the committed stop', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))

    const slider = screen.getByRole('slider', { name: '推理等级' })
    expect(sliderValue()).toBe('1')
    expect(slider.getAttribute('aria-valuetext')).toBe('High')
    expect(screen.getByText('Off')).toBeTruthy()
    expect(screen.getByText('Max')).toBeTruthy()
    // The stop's description belongs to the levels it was not selected on.
    expect(screen.queryByText('Largest budget')).toBeNull()
    // The glow reads the stop's normalized position, not its raw index.
    expect((slider.closest('div[style]') as HTMLElement).style.getPropertyValue('--dsh-effort-level'))
      .toBe(String(1 / 2))

    // A drag previews without submitting; the release commits exactly once.
    fireEvent.change(slider, { target: { value: '2' } })
    expect(select).not.toHaveBeenCalled()
    expect(screen.getByText('Largest budget')).toBeTruthy()
    fireEvent.pointerUp(slider)
    await waitFor(() => {
      expect(select).toHaveBeenCalledTimes(1)
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 DeepSeek-V4-Flash，推理等级 Max')
    })
    // The slider is a continuous control: committing keeps the pane open.
    expect(screen.getByRole('slider', { name: '推理等级' })).toBeTruthy()
  })

  it('offers the provider default as a chip when the adapter declares no model default', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: {
            efforts: [{ id: 'fast', name: 'Fast' }, { id: 'standard', name: 'Standard' }],
          },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))

    const slider = screen.getByRole('slider', { name: '推理等级' })
    expect(sliderValue()).toBe('0')
    expect(slider.getAttribute('aria-valuetext')).toBe('Default')

    fireEvent.change(slider, { target: { value: '1' } })
    fireEvent.keyUp(slider, { key: 'ArrowRight' })
    expect(select).toHaveBeenCalledWith({
      provider: 'provider',
      model: 'model',
      reasoningEffort: 'standard',
    })

    // The provider default has no stop of its own; the chip reflects the
    // store, which the mocked Host never moved off the default.
    const chip = screen.getByRole('menuitemradio', { name: 'Default' })
    expect(chip.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(chip)
    expect(sliderValue()).toBe('0')
    expect(screen.getByRole('slider', { name: '推理等级' }).getAttribute('aria-valuetext')).toBe('Default')
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('keeps a single advertised level selectable without a slider', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'off', name: 'Off' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))

    expect(screen.queryByRole('slider')).toBeNull()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Off' }))
    expect(select).toHaveBeenCalledWith({
      provider: 'provider',
      model: 'model',
      reasoningEffort: 'off',
    })
  })

  it('keeps a rejected effort off the trigger and announces it as a toast', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async () => {
      directory.set(state({ status: 'error', error: 'llm/reasoning-unsupported' }))
      return false
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const slider = screen.getByRole('slider', { name: '推理等级' })
    fireEvent.change(slider, { target: { value: '2' } })
    fireEvent.pointerUp(slider)

    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain('模型操作失败：llm/reasoning-unsupported')
    // The preview drops back to the store's level, which never moved.
    await waitFor(() => {
      expect(sliderValue()).toBe('1')
    })
  })

  it('leaves a release without a preview as a no-op', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    fireEvent.keyUp(screen.getByRole('slider', { name: '推理等级' }), { key: 'Tab' })
    expect(select).not.toHaveBeenCalled()
  })

  it('shows the durable model id when the catalog has no matching display name', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '选择模型，当前 deepseek-official/removed-model' })
    expect(trigger.textContent).toContain('deepseek-official/removed-model')
    fireEvent.click(trigger)
    expect(screen.queryByRole('menuitem', { name: /推理等级/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.queryByRole('menuitemradio', { name: 'removed-model' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
    expect(screen.queryByText('Fast catalog description')).toBeNull()
  })

  it('shows loading until the catalog and Session projection are both ready', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: null,
      routable: null,
      groups: [],
      status: 'loading',
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    expect(screen.getByRole('button', { name: '正在加载模型…' }).textContent)
      .toContain('正在加载模型…')
    directory.set(state())
    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
      })).toBeTruthy()
    })
  })

  it('announces a rejected selection as a transient toast and keeps the in-menu strip for loads', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      directory.set(state({ groups, status: 'error', error: 'session/model-unavailable: session already contains images' }))
      return false
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain('模型操作失败：session/model-unavailable: session already contains images')
    // The selection failure does not render the in-menu load strip (no Retry).
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<ModelSelect
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load}
      select={vi.fn().mockResolvedValue(false)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})
