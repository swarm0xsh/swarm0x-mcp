"""Ask Swarm0x whether a token on Robinhood Chain can be bought and sold.

No dependencies beyond the standard library. Python 3.9 or newer.

    python3 check.py 0x39065ac5dc2d771276e9f1c913f06d9f74e41e18

A free key raises the limits: set SWARM0X_KEY in the environment, or leave it out to start.
"""
import json
import os
import sys
import urllib.request

MCP = "https://api.swarm0x.sh/mcp"


def call(tool: str, arguments: dict) -> str:
    """One MCP tools/call over plain http. The answer is the text a person or a model reads."""
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": arguments}}
    # the api sits behind cloudflare, which turns away a request with no user agent of its own
    headers = {"content-type": "application/json", "accept": "application/json", "user-agent": "swarm0x-example/1.0"}
    key = os.environ.get("SWARM0X_KEY")
    if key:
        headers["authorization"] = f"Bearer {key}"
    req = urllib.request.Request(MCP, data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=60) as res:
        answer = json.load(res)
    if "error" in answer:
        raise RuntimeError(answer["error"].get("message", "the nest said no"))
    result = answer["result"]
    text = "\n".join(c["text"] for c in result.get("content", []) if c.get("type") == "text")
    if result.get("isError"):
        raise RuntimeError(text)
    return text


if __name__ == "__main__":
    token = sys.argv[1] if len(sys.argv) > 1 else "0x39065ac5dc2d771276e9f1c913f06d9f74e41e18"
    print(call("check_token", {"address": token}))
