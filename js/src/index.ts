/**
 * Swarm0x, from a program.
 *
 * One class over the http api at api.swarm0x.sh and the MCP tools behind it. Nothing to install beyond this, no
 * keys held: a check is a real buy and sell inside a simulation, and a prepared trade is unsigned transactions your
 * own wallet signs or not. A free key raises the limits and takes one signature; see https://docs.swarm0x.sh/agents/
 */

export const API_URL = 'https://api.swarm0x.sh'
export const CHAIN_ID = 4663

/** `unknown` means the nest could not find out. It is not a pass: do not buy on it. */
export type VerdictLevel = 'ok' | 'warn' | 'danger' | 'unknown'

export interface Verdict {
  code: string
  level: VerdictLevel
  text: string
}

export interface Amount {
  amount: string
  raw: string
  asset: string
  symbol: string | null
}

export interface Check {
  address: string
  chainId: number
  checkedAt: string
  verdict: Verdict
  flags: string[]
  token: {symbol: string | null; name: string | null; decimals: number | null; totalSupply: string | null; owner: string | null; ownerRenounced: boolean | null}
  venue: {kind: string; quote: string; poolFeeBps: number | null; dynamicFee: boolean; hook: string | null; pool: string | null; poolId: string | null; poolsFound: number} | null
  trade: {method: string; paid: {amount: string; asset: string}; tokensOut: string | null; roundTripLossBps: number | null; feesBps: number | null; priceImpactBps: number | null; buyReverts: string | null; sellReverts: string | null} | null
  price: {usd: number | null; marketCapUsd: number | null} | null
  pons: Record<string, unknown> | null
}

export interface Holder {
  address: string
  balance: string
  supplyBps: number
  firstSeen: string | null
  ageDays: number | null
  entryMarketCapUsd: number | null
  multiple: number | null
  soldBps: number
  tags: string[]
}

export interface Holders {
  address: string
  chainId: number
  checkedAt: string
  transfersRead: number
  /** `reading`: the chain is still being read. Ask again in a few seconds for the whole answer. */
  status: 'complete' | 'reading' | 'partial'
  token: {symbol: string | null; decimals: number; totalSupply: string}
  marketCapUsd: number | null
  holders: Record<string, unknown> | null
  top: Holder[]
  launch: Record<string, unknown> | null
  snipers: Record<string, unknown> | null
  bundle: Record<string, unknown> | null
  deployer: Record<string, unknown> | null
  smartMoney: Record<string, unknown> | null
  repeatCrowd: Record<string, unknown> | null
}

export interface Simulation {
  chainId: number
  block: number
  from: string
  verdict: Verdict
  calls: {ok: boolean; gasUsed: number; reverts: string | null}[]
  spent: Amount[]
  received: Amount[]
  approvals: {token: string; spender: string; amount: string | null; unlimited: boolean}[]
  sellBack: Record<string, unknown> | null
  check: Record<string, unknown> | null
  simulatedAt: string
}

export interface TradeStep {
  n: number
  does: string
  to: string
  data: string
  /** Wei, as a decimal string. */
  value: string
  gas: number
}

export interface PreparedTrade {
  chainId: number
  side: 'buy' | 'sell'
  from: string
  block: number
  token: {address: string; symbol: string | null; decimals: number}
  venue: {kind: string; at: string | null; pays: 'eth' | 'weth' | 'usdg'}
  spend: Amount
  expect: Amount & {min: string; minRaw: string}
  slippageBps: number
  validUntil: string
  /** True when the nest would not write it: the way out failed, or the check calls it a trap. `steps` is then empty. */
  refused: boolean
  steps: TradeStep[]
  alreadyDone: unknown[]
  sellBack: Record<string, unknown> | null
  verdict: Verdict
  check: Record<string, unknown>
  preparedAt: string
}

export interface Tool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
}

/** What a tool answered: the text a model reads, and the same thing as json when the tool gives one. */
export interface ToolAnswer {
  text: string
  data: Record<string, unknown> | null
}

export type SimulateInput =
  | {from: string; to: string; data: string; value?: string; fund?: boolean}
  | {from: string; calls: {to: string; data: string; value?: string}[]; fund?: boolean}

export interface BuyInput {
  token: string
  from: string
  /** How much to spend, in what the venue is paid in: "0.05" eth, or usdg. */
  amount: string
  slippageBps?: number
  fund?: boolean
}

export interface SellInput {
  token: string
  from: string
  /** "all", or tokens as a plain number in a string. Leave it out and give `percent` instead. */
  amount?: string
  percent?: number
  slippageBps?: number
}

export interface Options {
  /** A free key from https://docs.swarm0x.sh/agents/. Without one the daily limits are lower. */
  key?: string
  /** Where the api is. Only change it to point at your own nest. */
  baseUrl?: string
  /** Sent with every request. The api sits behind Cloudflare, which turns away a request with no user agent. */
  userAgent?: string
  /** Milliseconds before a request is given up on. A cold check reads the chain and can take a few seconds. */
  timeoutMs?: number
  /** Your own fetch, for tests or a proxy. */
  fetch?: typeof fetch
}

/** What the nest answered when it could not answer: a code a program can switch on, and the words. */
export class Swarm0xError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'Swarm0xError'
  }
}

export class Swarm0x {
  readonly baseUrl: string
  private readonly key: string | null
  private readonly userAgent: string
  private readonly timeoutMs: number
  private readonly fetchFn: typeof fetch
  private nextId = 1

  constructor(options: Options = {}) {
    this.baseUrl = (options.baseUrl ?? API_URL).replace(/\/+$/, '')
    this.key = options.key ?? null
    this.userAgent = options.userAgent ?? 'swarm0x-js/0.1.0'
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.fetchFn = options.fetch ?? fetch
  }

  /** Can it be bought and sold, and what a round trip costs. A real buy and sell inside a simulation, run now. */
  async check(address: string): Promise<Check> {
    return this.get<Check>(`/v1/check/${addr(address)}`)
  }

  /** Top holders with wallet age and entry, the launch bundle, snipers, the deployer, winning wallets holding it. */
  async holders(address: string): Promise<Holders> {
    return this.get<Holders>(`/v1/holders/${addr(address)}`)
  }

  /** Runs a transaction you are about to sign, from `from` as it stands right now, and tries to sell what it bought. */
  simulate(input: SimulateInput): Promise<Simulation> {
    return this.post<Simulation>('/v1/simulate', input)
  }

  /** A buy as unsigned transactions for `from` to sign, with the way out proven first. */
  prepareBuy(input: BuyInput): Promise<PreparedTrade> {
    return this.post<PreparedTrade>('/v1/prepare/buy', input)
  }

  /** A sell as unsigned transactions for `from` to sign. */
  prepareSell(input: SellInput): Promise<PreparedTrade> {
    return this.post<PreparedTrade>('/v1/prepare/sell', input)
  }

  /** Every MCP tool, with its input schema. */
  async tools(): Promise<Tool[]> {
    const r = (await this.rpc('tools/list', {})) as {tools?: Tool[]}
    return r.tools ?? []
  }

  /** One MCP tool by name. The text is what a model reads; `data` is the same answer as json when the tool gives one. */
  async tool(name: string, args: Record<string, unknown> = {}): Promise<ToolAnswer> {
    const r = (await this.rpc('tools/call', {name, arguments: args})) as {content?: {type: string; text?: string}[]; structuredContent?: Record<string, unknown>; isError?: boolean}
    const text = (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
    if (r.isError) throw new Swarm0xError(text || `${name} failed`, 'tool_error', 200)
    return {text, data: r.structuredContent ?? null}
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {accept: 'application/json', 'user-agent': this.userAgent}
    if (json) h['content-type'] = 'application/json'
    if (this.key) h.authorization = `Bearer ${this.key}`
    return h
  }

  private async send<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {...init, signal: controller.signal})
    } catch (e) {
      throw new Swarm0xError(controller.signal.aborted ? `no answer in ${this.timeoutMs} ms` : (e as Error).message, 'network', 0)
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      throw new Swarm0xError(`the api answered ${res.status} with something that is not json`, 'bad_answer', res.status)
    }
    if (!res.ok) {
      const err = (body as {error?: {code?: string; message?: string}} | null)?.error
      throw new Swarm0xError(err?.message ?? `http ${res.status}`, err?.code ?? (res.status === 429 ? 'rate_limited' : 'http_error'), res.status)
    }
    return body as T
  }

  private get<T>(path: string): Promise<T> {
    return this.send<T>(path, {method: 'GET', headers: this.headers(false)})
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>(path, {method: 'POST', headers: this.headers(true), body: JSON.stringify(body)})
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const answer = await this.send<{result?: unknown; error?: {code?: number; message?: string}}>('/mcp', {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({jsonrpc: '2.0', id: this.nextId++, method, params}),
    })
    if (answer.error) throw new Swarm0xError(answer.error.message ?? 'the nest said no', 'rpc_error', 200)
    return answer.result ?? {}
  }
}

const addr = (a: string): string => {
  const s = a.trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(s)) throw new Swarm0xError('an address is 0x and 40 hex characters', 'bad_address', 0)
  return s
}

export default Swarm0x
