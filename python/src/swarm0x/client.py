"""
One class over the http api at api.swarm0x.sh and the MCP tools behind it.

Nothing to install beyond this, no keys held: a check is a real buy and sell inside a simulation, and a prepared
trade is unsigned transactions your own wallet signs or not. A free key raises the limits and takes one signature;
see https://docs.swarm0x.sh/agents/
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Optional

API_URL = "https://api.swarm0x.sh"
CHAIN_ID = 4663
_ADDRESS = re.compile(r"^0x[0-9a-f]{40}$")


class Swarm0xError(Exception):
    """What the nest answered when it could not answer: a code a program can switch on, and the words."""

    def __init__(self, message: str, code: str, status: int = 0):
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass
class ToolAnswer:
    """What a tool answered: the text a model reads, and the same thing as json when the tool gives one."""

    text: str
    data: Optional[dict]


class Swarm0x:
    def __init__(
        self,
        key: Optional[str] = None,
        base_url: str = API_URL,
        user_agent: str = "swarm0x-py/0.1.0",
        timeout: float = 60.0,
        opener: Optional[Callable[[urllib.request.Request, float], Any]] = None,
    ):
        """
        key: a free key from https://docs.swarm0x.sh/agents/. Without one the daily limits are lower.
        base_url: where the api is. Only change it to point at your own nest.
        user_agent: sent with every request. The api sits behind Cloudflare, which turns away a request with none.
        timeout: seconds before a request is given up on. A cold check reads the chain and can take a few seconds.
        opener: your own transport, for tests or a proxy. It takes a Request and a timeout and returns a response.
        """
        self.base_url = base_url.rstrip("/")
        self.key = key
        self.user_agent = user_agent
        self.timeout = timeout
        self._open = opener or (lambda req, t: urllib.request.urlopen(req, timeout=t))
        self._next_id = 1

    # ------------------------------------------------------------------ the http api

    def check(self, address: str) -> dict:
        """Can it be bought and sold, and what a round trip costs. A real buy and sell inside a simulation, run now."""
        return self._get(f"/v1/check/{_addr(address)}")

    def holders(self, address: str) -> dict:
        """Top holders with wallet age and entry, the launch bundle, snipers, the deployer, winning wallets holding it."""
        return self._get(f"/v1/holders/{_addr(address)}")

    def simulate(self, from_: str, to: Optional[str] = None, data: Optional[str] = None, value: Optional[str] = None,
                 calls: Optional[list] = None, fund: Optional[bool] = None) -> dict:
        """Runs a transaction you are about to sign, from `from_` as it stands right now, and tries to sell what it bought."""
        body: dict = {"from": from_}
        if calls is not None:
            body["calls"] = calls
        else:
            body["to"] = to
            body["data"] = data
            if value is not None:
                body["value"] = value
        if fund is not None:
            body["fund"] = fund
        return self._post("/v1/simulate", body)

    def prepare_buy(self, token: str, from_: str, amount: str, slippage_bps: Optional[int] = None, fund: Optional[bool] = None) -> dict:
        """A buy as unsigned transactions for `from_` to sign, with the way out proven first."""
        body: dict = {"token": token, "from": from_, "amount": amount}
        if slippage_bps is not None:
            body["slippageBps"] = slippage_bps
        if fund is not None:
            body["fund"] = fund
        return self._post("/v1/prepare/buy", body)

    def prepare_sell(self, token: str, from_: str, amount: Optional[str] = None, percent: Optional[float] = None,
                     slippage_bps: Optional[int] = None) -> dict:
        """A sell as unsigned transactions for `from_` to sign. `amount` is "all" or a count of tokens, or give `percent`."""
        body: dict = {"token": token, "from": from_}
        if amount is not None:
            body["amount"] = amount
        if percent is not None:
            body["percent"] = percent
        if slippage_bps is not None:
            body["slippageBps"] = slippage_bps
        return self._post("/v1/prepare/sell", body)

    # ------------------------------------------------------------------ the mcp tools

    def tools(self) -> list:
        """Every MCP tool, with its input schema."""
        return self._rpc("tools/list", {}).get("tools", [])

    def tool(self, name: str, **arguments: Any) -> ToolAnswer:
        """One MCP tool by name. The text is what a model reads; `data` is the same answer as json when the tool gives one."""
        r = self._rpc("tools/call", {"name": name, "arguments": arguments})
        text = "\n".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text")
        if r.get("isError"):
            raise Swarm0xError(text or f"{name} failed", "tool_error", 200)
        return ToolAnswer(text=text, data=r.get("structuredContent"))

    # ------------------------------------------------------------------ the wire

    def _headers(self, with_json: bool) -> dict:
        h = {"accept": "application/json", "user-agent": self.user_agent}
        if with_json:
            h["content-type"] = "application/json"
        if self.key:
            h["authorization"] = f"Bearer {self.key}"
        return h

    def _send(self, path: str, body: Optional[dict], method: str) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, headers=self._headers(body is not None), method=method)
        try:
            res = self._open(req, self.timeout)
            status, text = res.status, res.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            status, text = e.code, e.read().decode("utf-8", "replace")
        except (urllib.error.URLError, OSError) as e:
            raise Swarm0xError(str(getattr(e, "reason", e)), "network", 0) from None
        try:
            parsed = json.loads(text) if text else None
        except ValueError:
            raise Swarm0xError(f"the api answered {status} with something that is not json", "bad_answer", status) from None
        if status >= 400:
            err = (parsed or {}).get("error") if isinstance(parsed, dict) else None
            code = (err or {}).get("code") or ("rate_limited" if status == 429 else "http_error")
            raise Swarm0xError((err or {}).get("message") or f"http {status}", code, status)
        return parsed

    def _get(self, path: str) -> dict:
        return self._send(path, None, "GET")

    def _post(self, path: str, body: dict) -> dict:
        return self._send(path, body, "POST")

    def _rpc(self, method: str, params: dict) -> dict:
        answer = self._send("/mcp", {"jsonrpc": "2.0", "id": self._next_id, "method": method, "params": params}, "POST")
        self._next_id += 1
        if isinstance(answer, dict) and answer.get("error"):
            raise Swarm0xError(answer["error"].get("message", "the nest said no"), "rpc_error", 200)
        return (answer or {}).get("result", {}) if isinstance(answer, dict) else {}


def _addr(a: str) -> str:
    s = a.strip().lower()
    if not _ADDRESS.match(s):
        raise Swarm0xError("an address is 0x and 40 hex characters", "bad_address", 0)
    return s
