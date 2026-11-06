# Security

Vitaquack moves real USDC on Arc mainnet. If you find a way to make a robot spend outside its grant, move an owner's
money, forge a "paid" on the counter, or read another owner's records, please tell us privately before anyone else.

## How to report

Use GitHub's private report: open the repository's **Security** tab and choose **Report a vulnerability**
(<https://github.com/grmkris/eth-global-mumbai-2026/security/advisories/new>). Please don't open a public issue for it.

Test with your own wallet, your own robot and small amounts. Don't touch other people's wallets, robots or payment
records.

We are a small team, so a reply can take a few days. We will tell you what we found and when a fix ships, and credit
you in the fix unless you'd rather we didn't.

## What we care about most

Arc is the spending authority. A robot's grant sets a daily cap, a per-payment cap, the merchants it may pay, an expiry
and a revocation switch, and Arc checks all of them when a payment lands. Our servers coordinate and relay; they should
never be able to authorise, redirect or steal a payment, only delay it. A finding that breaks this rule is the most
serious kind:

- a payment that settles over a cap, to a merchant outside the allowlist, after expiry or after Stop
- an invoice paid twice, or an approval reused
- a chip key or an owner's passkey session leaking from the server, the logs or the browser
- the counter showing "paid" for an invoice that was never paid

## In scope

- the contracts in `contracts/` and their deployments listed in `docs/evidence/contracts.md`
- the Workers and the web app (`packages/`, `apps/web`), the chip client (`apps/chip`), the café till (`apps/merchant`)
  and the simulator's software chip (`apps/sim`)
- the live deployment at <https://vitaquack.com>

Third-party code keeps its own licence and its own maintainers: `apps/sim/vendor/`, `repos/` and the vendored skills
under `.agents/skills/`. Please report problems there upstream. Bugs in Arc, 0G, World or the MetaMask Delegation
Framework themselves belong with those projects.
