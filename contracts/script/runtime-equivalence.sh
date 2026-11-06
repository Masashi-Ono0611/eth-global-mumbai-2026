#!/usr/bin/env bash
# Compares a Foundry artifact's runtime bytecode with the code deployed at one or more addresses, in full and with the
# trailing Solidity metadata removed (CBOR; its byte length is the last two bytes of the code). Exits 1 when any
# metadata-stripped code differs from the artifact's. Read-only: only `eth_getCode`.
#
#   script/runtime-equivalence.sh <artifact.json> <label> <rpc-url> <address> [<label> <rpc-url> <address> ...]
set -euo pipefail

strip_metadata() {
  local hex=${1#0x}
  local length=$((16#${hex: -4}))
  printf '0x%s' "${hex:0:${#hex}-(length + 2) * 2}"
}

describe() {
  local label=$1 code=$2
  local stripped
  stripped=$(strip_metadata "$code")
  printf '%-34s %6d bytes  full %s  without metadata %s\n' "$label" $(((${#code} - 2) / 2)) \
    "$(cast keccak "$code")" "$(cast keccak "$stripped")"
}

artifact=$1
shift
reference=$(jq -r .deployedBytecode.object "$artifact")
describe "artifact $(basename "$(dirname "$artifact")")" "$reference"
reference_stripped=$(cast keccak "$(strip_metadata "$reference")")

status=0
while [ $# -ge 3 ]; do
  code=$(cast code "$3" --rpc-url "$2")
  describe "$1 $3" "$code"
  if [ "$(cast keccak "$(strip_metadata "$code")")" != "$reference_stripped" ]; then
    echo "  ↳ DIFFERS from the artifact without metadata"
    status=1
  fi
  shift 3
done
exit $status
