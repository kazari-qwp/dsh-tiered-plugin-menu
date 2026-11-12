import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { Context } from '@deepseek-ai/cordis'
import { createPanel, type PanelProps } from '../packages/tui/src/panel.ts'
import type { PluginManager } from '../packages/core/src/index.ts'
import { clientScope, type Scope } from '../packages/core/src/shared.ts'

test('TUI 使用宿主 React：键盘修改作用域、确认、配置与切换会话', async () => {
  const ctx = new Context()
  const calls: any[] = [], replies: any[] = []
  const childScopes = new Set<string>()
  const values = new Map<string, any>()
  const own = (scope: Scope) => values.get(JSON.stringify(scope))
  const row = (scope: Scope) => ({ id: 'example', name: 'Example', package: 'example', description: '', verified: false,
    enabled: own(scope)?.enabled ?? true, own: !!own(scope), config: own(scope)?.config ?? { label: 'CLIENT' }, source: clientScope })
  const manager = {
    context: () => ({ workspaces: [{ id: 'W', title: 'Workspace', path: '/w' }] }),
    rows: async (scope: Scope) => [row(scope)],
    plan: async (scope: Scope, id: string, mode: string) => ({ scope, id, mode, changes: [], missing: [], dependencies: [], unverified: ['example'], signature: 'current' }),
    change: async (scope: Scope, id: string, mode: string) => {
      calls.push(['change', scope, id, mode]); values.set(JSON.stringify(scope), { enabled: mode === 'on', config: row(scope).config })
    },
    configure: async (scope: Scope, id: string, enabled: boolean, config: unknown) => {
      calls.push(['configure', scope, id, config]); values.set(JSON.stringify(scope), { enabled, config })
    },
    childSettings: (scope: Scope) => ({ independent: childScopes.has(JSON.stringify(scope)) }),
    setChildSettings: (scope: Scope, value: boolean) => { value ? childScopes.add(JSON.stringify(scope)) : childScopes.delete(JSON.stringify(scope)) },
    skills: { rows: async () => [] },
  } as unknown as PluginManager
  ctx.provide('tuiDialogs', { select: async () => replies.shift(), confirm: async () => replies.shift(), input: async () => replies.shift() })
  let listener: Parameters<PanelProps['host']['onKey']>[0] | undefined
  let sessionId = 'A'
  const props: PanelProps = { React, height: 24, focused: true, visible: true,
    ui: { Box: 'box' as any, Text: 'text' as any },
    host: { snapshot: () => ({ sessionId }), onKey: fn => { listener = fn; return () => { listener = undefined } } } }
  let renderer: ReactTestRenderer
  const Panel = createPanel(ctx, manager)
  const send = async (input: string, key: Record<string, boolean> = {}) => {
    await act(async () => { listener!({ input, key, preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)) })
  }
  try {
    await act(async () => { renderer = create(React.createElement(Panel, props)) })
    replies.push('on', false)
    await send('', { return: true })
    assert.equal(calls.length, 0, '取消确认不能写配置')
    replies.push('on', true)
    await send('', { return: true })
    assert.deepEqual(calls[0], ['change', { level: 'session', id: 'A' }, 'example', 'on'])
    replies.push('label', '"FROM TUI"')
    await send('e')
    assert.equal(own({ level: 'session', id: 'A' }).config.label, 'FROM TUI')
    await send('c'); await send('d')
    assert.ok(childScopes.has(JSON.stringify({ level: 'session', id: 'A' })))
    sessionId = 'B'
    await act(async () => { renderer.update(React.createElement(Panel, props)) })
    replies.push('on', true); await send('', { return: true })
    assert.deepEqual(calls.at(-1)?.[1], { level: 'session', id: 'B' })
    assert.equal(own({ level: 'session', id: 'B' }).config.label, 'CLIENT')
    await send('3')
    assert.match(JSON.stringify(renderer!.toJSON()), /没有可配置的项目/)
    const before = JSON.stringify(renderer!.toJSON())
    await send('1', { ctrl: true })
    assert.equal(JSON.stringify(renderer!.toJSON()), before, 'Ctrl 组合键不误触字母快捷键')
  } finally { await act(async () => renderer?.unmount()); await ctx.fiber.dispose() }
})
