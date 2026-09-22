import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Swarm0x, Swarm0xError} from '../dist/index.js'

const T = '0x39065ac5dc2d771276e9f1c913f06d9f74e41e18'

/** A fetch that records what it was asked and answers with what the test says. */
function fake(answer, status = 200) {
  const seen = []
  const fetchFn = async (url, init) => {
    seen.push({url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null})
    return new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), {status, headers: {'content-type': 'application/json'}})
  }
  return {seen, fetchFn}
}

test('check is a GET with the address lowercased, the key as a bearer and a user agent', async () => {
  const {seen, fetchFn} = fake({address: T, verdict: {code: 'ok', level: 'ok', text: 'buys and sells go through.'}})
  const nest = new Swarm0x({key: 'k1', fetch: fetchFn})
  const r = await nest.check(T.toUpperCase().replace('0X', '0x'))
  assert.equal(r.verdict.level, 'ok')
  assert.equal(seen[0].url, `https://api.swarm0x.sh/v1/check/${T}`)
  assert.equal(seen[0].method, 'GET')
  assert.equal(seen[0].headers.authorization, 'Bearer k1')
  assert.match(seen[0].headers['user-agent'], /^swarm0x-js\//)
})

test('a bad address never leaves the process', async () => {
  const nest = new Swarm0x({fetch: fake({}).fetchFn})
  await assert.rejects(() => nest.check('0x1234'), (e) => e instanceof Swarm0xError && e.code === 'bad_address')
})

test('the api error code and words come through', async () => {
  const {fetchFn} = fake({error: {code: 'rate_limited', message: 'too many today. a free key raises the limit.'}}, 429)
  const nest = new Swarm0x({fetch: fetchFn})
  await assert.rejects(() => nest.holders(T), (e) => e instanceof Swarm0xError && e.code === 'rate_limited' && e.status === 429 && /free key/.test(e.message))
})

test('prepare and simulate are POSTs with the body as given', async () => {
  const {seen, fetchFn} = fake({side: 'buy', refused: false, steps: []})
  const nest = new Swarm0x({fetch: fetchFn, baseUrl: 'http://127.0.0.1:4663/'})
  await nest.prepareBuy({token: T, from: T, amount: '0.05'})
  await nest.simulate({from: T, to: T, data: '0x', value: '1'})
  assert.equal(seen[0].url, 'http://127.0.0.1:4663/v1/prepare/buy')
  assert.deepEqual(seen[0].body, {token: T, from: T, amount: '0.05'})
  assert.equal(seen[0].headers['content-type'], 'application/json')
  assert.equal(seen[1].url, 'http://127.0.0.1:4663/v1/simulate')
  assert.equal(seen[1].body.value, '1')
})

test('a tool call is json-rpc over /mcp, and answers with the text and the structured json', async () => {
  const {seen, fetchFn} = fake({jsonrpc: '2.0', id: 1, result: {content: [{type: 'text', text: 'verdict: ok.'}], structuredContent: {verdict: {level: 'ok'}}}})
  const nest = new Swarm0x({fetch: fetchFn})
  const a = await nest.tool('check_token', {address: T})
  assert.equal(a.text, 'verdict: ok.')
  assert.deepEqual(a.data, {verdict: {level: 'ok'}})
  assert.equal(seen[0].url, 'https://api.swarm0x.sh/mcp')
  assert.deepEqual(seen[0].body, {jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'check_token', arguments: {address: T}}})
})

test('a tool that failed throws with its words, and tools/list is a list', async () => {
  const bad = fake({jsonrpc: '2.0', id: 1, result: {content: [{type: 'text', text: 'address must be an address.'}], isError: true}})
  await assert.rejects(() => new Swarm0x({fetch: bad.fetchFn}).tool('check_token', {address: 'x'}), (e) => e instanceof Swarm0xError && e.code === 'tool_error' && /must be an address/.test(e.message))
  const list = fake({jsonrpc: '2.0', id: 1, result: {tools: [{name: 'check_token', description: 'x', inputSchema: {}}]}})
  const tools = await new Swarm0x({fetch: list.fetchFn}).tools()
  assert.equal(tools[0].name, 'check_token')
})

test('an answer that is not json is said plainly', async () => {
  const {fetchFn} = fake('<html>challenge</html>', 403)
  await assert.rejects(() => new Swarm0x({fetch: fetchFn}).check(T), (e) => e.code === 'bad_answer' && e.status === 403)
})
