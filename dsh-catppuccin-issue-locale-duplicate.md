# 开启其他注册 `ja`/`ko` 语言包的插件后，客户端 `apply()` 抛错，主题与设置行全部失效

## 环境

- DSH：`0.2.1-alpha.2`（web profile，Windows）
- `@nonamelego/dsh-catppuccin`：`0.6.1`（当前 npm latest）
- 同时安装：`@hytime/dsh-thinking-effort@0.3.9`（也会注册 `ja`/`ko`，但它有重复检测）

## 现象

只要启用 `@hytime/dsh-thinking-effort`，catppuccin 的客户端插件就完全不工作：

- 四套 Catppuccin 主题无法选择（Appearance 里没有）；
- Settings → 通用里 `catppuccin` / `catppuccin-glass` / `catppuccin-update` 三行不出现；
- 插件详情卡不出现；
- 浏览器控制台报错：

```
Uncaught Error: locale "ja" is already registered
```

把 thinking-effort 关掉后 catppuccin 立刻恢复正常；两者的组合 100% 复现。

## 根因

`@deepseek-ai/dsh-client-locale` 的 `LocaleRuntime.addLanguage()` 对**重复的 locale id 直接抛错**（DSH `packages/client/locale/src/client/index.ts:278`）：

```ts
if (this.catalog.has(key)) throw new Error(`locale "${candidate.id}" is already registered`)
```

而本插件的客户端 `apply()` 在一个 `ctx.effect()` 里**无条件**注册 5 个语言：

```ts
// src/client/index.ts（0.6.1，lib/client.js:3960-4001 同一份逻辑）
ctx.effect(() => {
  const disposers = [
    ctx.locale.register(NS, { zh, en }),
    ctx.locale.register(NS, 'ja', ja),
    ctx.locale.register(NS, 'ko', ko),
    ctx.locale.register(NS, 'es', es),
    ctx.locale.register(NS, 'fr', fr),
    ctx.locale.register(NS, 'de', de),
    ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }),   // ← 抛错点
    ctx.locale.addLanguage({ id: 'ko', label: '한국어', fallback: 'en' }),
    ctx.locale.addLanguage({ id: 'es', label: 'Español', fallback: 'en' }),
    ctx.locale.addLanguage({ id: 'fr', label: 'Français', fallback: 'en' }),
    ctx.locale.addLanguage({ id: 'de', label: 'Deutsch', fallback: 'en' })
  ]
  return () => { for (const dispose of disposers) dispose() }
}, 'catppuccin: dictionaries')
```

这里既没有“是否已存在”的判断，也没有 `try/catch`。Cordis 对 `ctx.effect()` 里同步抛出的异常是**原样上抛**的（`vendor/cordis/src/fiber.ts:521-537`），于是整个 `apply()` 在这里中断 —— 后面所有注册（`theme.register`、GlassLayer、三行设置项、详情卡）都不会执行，这就是“插件崩溃”的表现。

### 为什么顺序是固定的（不是偶发竞态）

本插件客户端注入的是 `['slots', 'locale', 'theme']`，而 `theme` 由 ui-theme 提供，ui-theme 自身注入 `['slots', 'locale', 'remote', 'configForms']`（DSH `packages/client/ui-theme/src/client/index.ts:478`）。也就是说本插件的 `apply()` 必须排在 “`locale` → ui-theme → `theme`” 这一整条链之后；而只依赖 `locale` 的语言包插件（如 thinking-effort，注入 `['slots','connection','locale']`）总是更早完成注册。因此只要存在另一个先注册 `ja`/`ko` 的插件，**必然**是本插件抛错，与 roster 顺序无关。

### 最小复现

用 cordis 按其真实依赖形状建模（`locale-provider → ui-theme → catppuccin`，thinking-effort 与之并列），两种注册顺序结果一致：

```
thinking-effort.apply → addLanguage(ja) → addLanguage(ko)
ui-theme.apply
catppuccin.THREW: locale "ja" is already registered
```

### 额外影响

抛错发生在拼接 `disposers` 数组的过程中，前面 6 次 `ctx.locale.register(NS, ...)` 的 disposer 没能返回给 `ctx.effect`，这些字典注册在页面生命周期内**无法回收**；重载/热更新会再撞上 `locale namespace "catppuccin" already has locale "zh"`。

## 建议修复

按 per-id 守卫 + 兜底 `try/catch`，并逐条收集 disposer：

```ts
ctx.effect(() => {
  const disposers = [
    ctx.locale.register(NS, { zh, en }),
    ctx.locale.register(NS, 'ja', ja),
    ctx.locale.register(NS, 'ko', ko),
    ctx.locale.register(NS, 'es', es),
    ctx.locale.register(NS, 'fr', fr),
    ctx.locale.register(NS, 'de', de)
  ]
  // 其他语言包可能已经注册了同一个 id；重复注册会抛错并中断整个 apply()。
  const hasLanguage = (id: string) => {
    const snapshot = ctx.locale.getSnapshot?.()
    return Array.isArray(snapshot?.locales) && snapshot.locales.some(entry => entry?.id === id)
  }
  for (const definition of [
    { id: 'ja', label: '日本語', fallback: 'en' },
    { id: 'ko', label: '한국어', fallback: 'en' },
    { id: 'es', label: 'Español', fallback: 'en' },
    { id: 'fr', label: 'Français', fallback: 'en' },
    { id: 'de', label: 'Deutsch', fallback: 'en' }
  ] as const) {
    if (hasLanguage(definition.id)) continue
    try {
      disposers.push(ctx.locale.addLanguage(definition))
    } catch {
      // 兜底：旧版 DSH 的 locale face 可能没有 getSnapshot
    }
  }
  return () => { for (const dispose of disposers) dispose() }
}, 'catppuccin: dictionaries')
```

`ja`/`ko` 被跳过时用户体验不受影响：选择器里的语言项来自已经注册的定义，本插件的字典仍按 namespace 正常生效。

## 当前临时规避

已在本机安装产物 `node_modules/@nonamelego/dsh-catppuccin/lib/client.js` 上打了同样的守卫补丁（`client.js.bak-localpatch` 为原文件备份），重载页面后 catppuccin 与 thinking-effort 可共存。官方修复发版前，这个本地补丁会被重新安装覆盖。
