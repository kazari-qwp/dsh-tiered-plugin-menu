import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { ConversationSettings, MenuDialog } from '../packages/web/src/client/menu.tsx'
import { childScope, clientScope, isClientScope, scopeKey, type PluginRow, type SkillRow, type Scope } from '../packages/core/src/shared.ts'
import { withChangePlans } from './menu-api.ts'

test('官方插件位于插件下一行，列表不重复，本级与下级使用相同作用域操作', async () => {
  const scope: Scope = { level: 'session', id: 'A' }
  const writes: Scope[] = []
  const base: PluginRow = { id: 'community', name: '社区插件', package: 'community', description: '', source: clientScope,
    config: {}, enabled: false, own: false, active: false, settings: 'native', verified: true }
  const api = withChangePlans({
    context: async () => ({ ok: true, value: { workspaces: [], workspaceId: null } }),
    list: async () => ({ ok: true, value: [base, { ...base, id: 'official', name: '官方测试', package: 'official', official: true }] }),
    configure: async s => { writes.push(s); return { ok: true, value: undefined } },
    inherit: async s => { writes.push(s); return { ok: true, value: undefined } },
  })
  let view!: ReactTestRenderer
  try {
    await act(async () => { view = create(createElement(MenuDialog, { api, Page: () => null, ui: { Artwork: () => null, openDetails() {} }, target: { scope }, onClose() {} })) })
    const tab = async (name: string) => act(async () => { view.root.findAllByProps({ role: 'tab' }).find(n => n.children.includes(name))!.props.onClick() })
    const shown = () => view.root.findAllByProps({ className: 'tiered-card-open' }).map(n => n.children[0])
    assert.deepEqual(view.root.findByProps({ 'aria-label': '资源类型' }).findAllByType('button').map(n => n.children[0]), ['插件', '官方插件', 'MCP', 'Skill'])
    assert.deepEqual(shown(), ['社区插件'])
    await tab('官方插件')
    assert.deepEqual(shown(), ['官方测试'])
    await act(async () => { view.root.findByProps({ 'data-mode': 'on' }).props.onClick() })
    assert.deepEqual(writes.at(-1), scope)
    await tab('下级')
    assert.equal(view.root.findByProps({ 'data-mode': 'on' }).props.disabled, false)
    await act(async () => { view.root.findByProps({ 'data-mode': 'on' }).props.onClick() })
    assert.deepEqual(writes.at(-1), childScope(scope))
    await tab('插件')
    assert.deepEqual(shown(), ['社区插件'])
  } finally { await act(async () => view?.unmount()) }
})

test('left resource tabs: MCP/Skill edits, scoped toggles and shared child defaults', async () => {
  const scope: Scope = { level: 'workspace', id: 'one' }
  const calls: { type: string; scope: Scope; config?: unknown }[] = []
  const mcp: PluginRow = { id: 'mcp:one', kind: 'mcp', name: 'local', description: 'MCP server', package: '@deepseek-ai/dsh-mcp-client',
    source: clientScope, own: false, active: true, enabled: true, config: { serverName: 'local', transport: 'stdio', command: 'node' }, settings: 'native', verified: true }
  const skill: SkillRow = { id: 'local-review', name: 'local-review', description: 'Review', source: clientScope, own: false, available: true, enabled: true, config: {} }
  const api = withChangePlans({
    context: async () => ({ ok: true, value: { workspaces: [], workspaceId: null } }),
    list: async s => ({ ok: true, value: [{ ...mcp, own: isClientScope(s) || mcp.own }] }),
    configure: async (s, _id, enabled, config) => { calls.push({ type: 'mcp', scope: s, config }); Object.assign(mcp, { enabled, config, own: true }); return { ok: true, value: undefined } },
    inherit: async s => { calls.push({ type: 'mcp-inherit', scope: s }); mcp.own = false; return { ok: true, value: undefined } },
  })
  api.skills = async () => ({ ok: true, value: [skill] })
  api.skillConfig = async () => ({ ok: true, value: { description: 'Review', content: 'ORIGINAL', modelInvocable: true, userInvocable: true } })
  api.configureSkill = async (s, _id, enabled, config) => { calls.push({ type: 'skill', scope: s, config }); Object.assign(skill, { enabled, config, own: true }); return { ok: true, value: undefined } }
  api.inheritSkill = async s => { calls.push({ type: 'skill-inherit', scope: s }); skill.own = false; return { ok: true, value: undefined } }
  api.addMcp = async (s, config) => { calls.push({ type: 'mcp-add', scope: s, config }); return { ok: true, value: 'new' } }
  let tree!: ReactTestRenderer
  const props = { api, Page: () => null, ui: { Artwork: () => null, openDetails() {} }, target: { scope }, onClose() {} }
  try {
    await act(async () => { tree = create(createElement(MenuDialog, props)) })
    const tab = (label: string) => tree.root.findAllByType('button').find(node => node.props.role === 'tab' && node.children.includes(label))!
    const click = async (label: string) => act(async () => { tree.root.findAllByType('button').find(node => node.children.includes(label))!.props.onClick() })
    assert.equal(tree.root.findByProps({ 'aria-label': '资源类型' }).props['aria-orientation'], 'vertical')
    assert.equal(tab('插件').props['aria-selected'], true)
    assert.equal(tree.root.findAllByProps({ 'aria-label': 'local配置方式' }).length, 0, 'MCP rows are not duplicated under plugins')
    await act(async () => { tab('MCP').props.onClick() })
    await click('设置 ')
    await act(async () => { tree.root.findByProps({ 'aria-label': 'MCP 服务器配置' }).props.onChange({ target: { value: JSON.stringify({ ...mcp.config, env: { LABEL: 'WORKSPACE' } }) } }) })
    await click('保存设置')
    assert.equal(calls.at(-1)?.type, 'mcp')
    assert.deepEqual(calls.at(-1)?.scope, scope)
    assert.deepEqual((calls.at(-1)?.config as any).env, { LABEL: 'WORKSPACE' })
    await act(async () => { tab('Skill').props.onClick() })
    await click('设置 ')
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Skill 正文' }).props.onChange({ target: { value: 'WORKSPACE BODY' } }) })
    await click('保存设置')
    assert.equal((calls.at(-1)?.config as any).content, 'WORKSPACE BODY')
    await act(async () => { tab('下级').props.onClick() })
    assert.equal(tree.root.findByProps({ 'aria-label': 'local-review配置方式' }).findAllByType('button').some(node => node.props.disabled), false)
    await act(async () => { tree.root.findByProps({ 'aria-label': 'local-review配置方式' }).findAllByType('button').find(node => node.children.includes('关闭'))!.props.onClick() })
    assert.equal(calls.at(-1)?.type, 'skill')
    assert.equal(scopeKey(calls.at(-1)!.scope), scopeKey(childScope(scope)))
    await act(async () => { tab('MCP').props.onClick() })
    assert.equal(tab('下级').props['aria-selected'], true)
    await click('＋ 添加 MCP')
    await act(async () => { tree.root.findByProps({ 'aria-label': 'MCP 服务器配置' }).props.onChange({ target: { value: '{"serverName":"child","transport":"stdio","command":"node"}' } }) })
    await click('添加并启用')
    assert.deepEqual(calls.at(-1), { type: 'mcp-add', scope: childScope(scope), config: { serverName: 'child', transport: 'stdio', command: 'node' } })
  } finally { await act(async () => tree?.unmount()) }
})

test('conversation settings follow the displayed parent, child and grandchild session', async () => {
  const calls: Scope[] = []
  const api = withChangePlans({
    list: async scope => { calls.push(scope); return { ok: true, value: [] } },
    context: async () => ({ ok: true, value: { workspaces: [], workspaceId: null } }),
    configure: async () => ({ ok: true, value: undefined }),
    inherit: async () => ({ ok: true, value: undefined }),
  })
  api.skills = async scope => { calls.push(scope); return { ok: true, value: [] } }
  const props = { api, Page: () => null, ui: { Artwork: () => null, openDetails() {} } }
  let tree!: ReactTestRenderer
  const tab = (label: string) => tree.root.findAllByProps({ role: 'tab' }).find(node => node.children.includes(label))!
  try {
    await act(async () => { tree = create(createElement(ConversationSettings, { ...props, sessionId: 'parent' })) })
    assert.deepEqual(calls.at(-1), { level: 'session', id: 'parent' })
    await act(async () => { tab('下级').props.onClick() })
    assert.deepEqual(calls.at(-1), { level: 'session', id: 'parent', children: true })
    for (const sessionId of ['child', 'grandchild', 'parent']) {
      await act(async () => { tree.update(createElement(ConversationSettings, { ...props, sessionId })) })
      assert.equal(tab('本级').props['aria-selected'], true)
      assert.equal(tab('插件').props['aria-selected'], true)
      assert.deepEqual(calls.at(-1), { level: 'session', id: sessionId })
      await act(async () => { tab('Skill').props.onClick() })
      assert.deepEqual(calls.at(-1), { level: 'session', id: sessionId })
      await act(async () => { tab('下级').props.onClick() })
      assert.deepEqual(calls.at(-1), { level: 'session', id: sessionId, children: true })
    }
  } finally { await act(async () => { tree.unmount() }) }
})
