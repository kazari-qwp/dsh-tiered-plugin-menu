import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { mountWorkspaces } from './workspaces.ts'
import { mountPluginManagement } from './plugins.ts'

export async function resourceHarness() {
  mkdirSync('work', { recursive: true })
  const directory = resolve(mkdtempSync('work/resources-sandbox-'))
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await mountWorkspaces(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(Loader)
  ctx.loader.import = name => import(name)
  mountPluginManagement(ctx)
  if (!ctx.get('skills')) await ctx.plugin(SkillRegistry)
  await ctx.plugin(McpResources)
  await mountAgentLoopTestHarness(ctx)
  const workspace = async (name: string) => {
    const path = resolve(directory, name); mkdirSync(path, { recursive: true })
    return ctx.workspaceRegistry.create(path)
  }
  const create = async (id: string, cwd?: string, parentAgent?: Agent) => (await ctx.agents.create({ sessionId: SessionId(id), parentAgent,
    meta: { cwd, ...(parentAgent ? { origin: 'subagent', parentSession: parentAgent.id } : {}) } })).agent
  return { ctx, directory, workspace, create, dataFile: resolve(directory, 'menu.json') }
}
