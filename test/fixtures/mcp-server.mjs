import { createInterface } from 'node:readline'

// A stdio MCP endpoint with no filesystem or network access, used by the real DSH bridge.
const label = process.env.TIERED_TEST_LABEL ?? 'base'
const respond = request => {
  switch (request.method) {
    case 'initialize': return { protocolVersion: request.params.protocolVersion, capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'tiered-fixture', version: '1' }, instructions: `Only ${label} instructions.` }
    case 'tools/list': return { tools: [{ name: 'echo', description: `echo ${label}`, inputSchema: { type: 'object', properties: {} } }] }
    case 'tools/call': return { content: [{ type: 'text', text: label }] }
    case 'resources/list': return { resources: [{ uri: 'fixture://label', name: label }] }
    case 'resources/templates/list': return { resourceTemplates: [] }
    case 'resources/read': return { contents: [{ uri: request.params.uri, text: label, mimeType: 'text/plain' }] }
    case 'ping': return {}
    default: throw new Error(`Unsupported method: ${request.method}`)
  }
}
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  try { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: respond(request) }) + '\n') }
  catch (error) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: error.message } }) + '\n') }
})
