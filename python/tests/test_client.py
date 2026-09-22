import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from swarm0x import Swarm0x, Swarm0xError  # noqa: E402

T = "0x39065ac5dc2d771276e9f1c913f06d9f74e41e18"


class Fake:
    """An opener that records what it was asked and answers with what the test says."""

    def __init__(self, answer, status=200):
        self.answer, self.status, self.seen = answer, status, []

    def __call__(self, req, timeout):
        self.seen.append({"url": req.full_url, "method": req.get_method(), "headers": {k.lower(): v for k, v in req.header_items()}, "body": json.loads(req.data) if req.data else None})
        text = self.answer if isinstance(self.answer, str) else json.dumps(self.answer)
        if self.status >= 400:
            raise urllib.error.HTTPError(req.full_url, self.status, "nope", {}, io.BytesIO(text.encode()))
        res = io.BytesIO(text.encode())
        res.status = self.status
        return res


class ClientTest(unittest.TestCase):
    def test_check_is_a_get_with_the_key_and_a_user_agent(self):
        f = Fake({"address": T, "verdict": {"code": "ok", "level": "ok", "text": "buys and sells go through."}})
        r = Swarm0x(key="k1", opener=f).check(T.upper().replace("0X", "0x"))
        self.assertEqual(r["verdict"]["level"], "ok")
        self.assertEqual(f.seen[0]["url"], f"https://api.swarm0x.sh/v1/check/{T}")
        self.assertEqual(f.seen[0]["method"], "GET")
        self.assertEqual(f.seen[0]["headers"]["authorization"], "Bearer k1")
        self.assertTrue(f.seen[0]["headers"]["user-agent"].startswith("swarm0x-py/"))

    def test_a_bad_address_never_leaves_the_process(self):
        with self.assertRaises(Swarm0xError) as c:
            Swarm0x(opener=Fake({})).check("0x1234")
        self.assertEqual(c.exception.code, "bad_address")

    def test_the_api_error_comes_through(self):
        f = Fake({"error": {"code": "rate_limited", "message": "too many today. a free key raises the limit."}}, 429)
        with self.assertRaises(Swarm0xError) as c:
            Swarm0x(opener=f).holders(T)
        self.assertEqual((c.exception.code, c.exception.status), ("rate_limited", 429))
        self.assertIn("free key", str(c.exception))

    def test_prepare_and_simulate_post_the_body_as_given(self):
        f = Fake({"side": "buy", "refused": False, "steps": []})
        nest = Swarm0x(opener=f, base_url="http://127.0.0.1:4663/")
        nest.prepare_buy(T, T, "0.05", slippage_bps=100)
        nest.simulate(T, to=T, data="0x", value="1")
        nest.prepare_sell(T, T, percent=50)
        self.assertEqual(f.seen[0]["url"], "http://127.0.0.1:4663/v1/prepare/buy")
        self.assertEqual(f.seen[0]["body"], {"token": T, "from": T, "amount": "0.05", "slippageBps": 100})
        self.assertEqual(f.seen[0]["headers"]["content-type"], "application/json")
        self.assertEqual(f.seen[1]["body"], {"from": T, "to": T, "data": "0x", "value": "1"})
        self.assertEqual(f.seen[2]["body"], {"token": T, "from": T, "percent": 50})

    def test_a_tool_call_is_json_rpc_with_text_and_data(self):
        f = Fake({"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": "verdict: ok."}], "structuredContent": {"verdict": {"level": "ok"}}}})
        a = Swarm0x(opener=f).tool("check_token", address=T)
        self.assertEqual((a.text, a.data), ("verdict: ok.", {"verdict": {"level": "ok"}}))
        self.assertEqual(f.seen[0]["url"], "https://api.swarm0x.sh/mcp")
        self.assertEqual(f.seen[0]["body"], {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "check_token", "arguments": {"address": T}}})

    def test_a_failed_tool_raises_and_tools_is_a_list(self):
        bad = Fake({"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": "address must be an address."}], "isError": True}})
        with self.assertRaises(Swarm0xError) as c:
            Swarm0x(opener=bad).tool("check_token", address="x")
        self.assertEqual(c.exception.code, "tool_error")
        tools = Swarm0x(opener=Fake({"jsonrpc": "2.0", "id": 1, "result": {"tools": [{"name": "check_token"}]}})).tools()
        self.assertEqual(tools[0]["name"], "check_token")

    def test_an_answer_that_is_not_json_is_said_plainly(self):
        with self.assertRaises(Swarm0xError) as c:
            Swarm0x(opener=Fake("<html>challenge</html>", 403)).check(T)
        self.assertEqual((c.exception.code, c.exception.status), ("bad_answer", 403))


if __name__ == "__main__":
    unittest.main()
