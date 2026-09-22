/**
 * Ask Swarm0x whether a token on Robinhood Chain can be bought and sold.
 *
 * Nothing to install: it is fetch and json. Run it with `npx tsx check.ts 0x…`, or strip the types and run it with node 18 or newer.
 * A free key raises the limits: set SWARM0X_KEY in the environment, or leave it out to start.
 */

const MCP = 'https://api.swarm0x.sh/mcp'

interface Content {
  type: string
  text?: string
}

/** One MCP tools/call over plain http. The answer is the text a person or a model reads. */
export async function call(tool: string, args: Record<string, unknown>): Promise<string> {
  const headers: Record<string, string> = {'content-type': 'application/json', accept: 'application/json', 'user-agent': 'swarm0x-example/1.0'}
  const key = process.env.SWARM0X_KEY
  if (key) headers.authorization = `Bearer ${key}`
  const res = await fetch(MCP, {
    method: 'POST',
    headers,
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: tool, arguments: args}}),
  })
  const answer = (await res.json()) as {result?: {content?: Content[]; isError?: boolean}; error?: {message?: string}}
  if (answer.error) throw new Error(answer.error.message ?? 'the nest said no')
  const text = (answer.result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
  if (answer.result?.isError) throw new Error(text)
  return text
}

async function main(): Promise<void> {
  const token = process.argv[2] ?? '0x39065ac5dc2d771276e9f1c913f06d9f74e41e18'
  console.log(await call('check_token', {address: token}))
}

main().catch((e: Error) => {
  console.error(e.message)
  process.exit(1)
})
