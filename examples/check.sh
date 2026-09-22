#!/usr/bin/env sh
# Swarm0x from a shell: list the tools, then check one token. Needs curl. jq makes it readable but is optional.
#   sh check.sh 0x39065ac5dc2d771276e9f1c913f06d9f74e41e18
MCP=https://api.swarm0x.sh/mcp
TOKEN=${1:-0x39065ac5dc2d771276e9f1c913f06d9f74e41e18}

echo "== the tools"
curl -sS "$MCP" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | (jq -r '.result.tools[].name' 2>/dev/null || cat)

echo
echo "== check $TOKEN"
curl -sS "$MCP" -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"check_token\",\"arguments\":{\"address\":\"$TOKEN\"}}}" \
  | (jq -r '.result.content[0].text' 2>/dev/null || cat)

# The same check over plain http, as json with every field:
#   curl https://api.swarm0x.sh/v1/check/$TOKEN
