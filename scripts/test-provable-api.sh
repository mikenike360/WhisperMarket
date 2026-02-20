#!/usr/bin/env bash
# Test Provable API v2 testnet for whisper_market_v2.aleo
# Usage: ./scripts/test-provable-api.sh [address]
# If address is omitted, uses a placeholder for user_collateral test.

set -e
BASE="https://api.provable.com/v2/testnet"
PROGRAM="whisper_market_v2.aleo"
ADDRESS="${1:-aleo12c37wnemh8568n6cmnlcsglh9x8fj6yc2wtzfm3fz9342j7sdczqjpv05a}"

echo "=== Provable API tests for $PROGRAM (testnet) ==="
echo ""

test_mapping() {
  local name="$1"
  local key="$2"
  local url="$BASE/program/$PROGRAM/mapping/$name/$key"
  local code
  code=$(curl -s -o /tmp/provable_out.txt -w "%{http_code}" "$url")
  echo -n "$name: HTTP $code"
  if [ "$code" = "200" ]; then
    echo " -> $(cat /tmp/provable_out.txt)"
  else
    echo ""
  fi
}

echo "1. Program / enumeration mappings"
test_mapping "total_markets" "0u64"
test_mapping "market_index" "0u64"

echo ""
echo "2. user_collateral (404 = key not set, normal for new address)"
test_mapping "user_collateral" "${ADDRESS}field"

echo ""
echo "Done. 404 on user_collateral is expected until that address has deposited."
