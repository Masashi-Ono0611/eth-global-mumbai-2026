#!/usr/bin/env bash
# Builds the pulled contracts exactly as Arc Studio does (Studio's foundry.toml and remappings, sources at
# contracts/<Name>.sol under Studio's root) into out/studio. The runtime bytecode, metadata included, then equals
# Studio's own build and its Arc testnet deployments; DeployArc and DeployZg deploy these artifacts.
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD/studio"
forge build --root "$root" --out "$PWD/out/studio" --cache-path "$PWD/cache/studio" \
  "$root/contracts/RobotPaymentPolicyEnforcer.sol" "$root/contracts/EpisodeLog.sol"
