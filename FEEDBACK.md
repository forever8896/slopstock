# Uniswap API — Builder Feedback

> Required for the Uniswap "Best API integration" prize.
>
> **Instructions for the team:** keep this file open during the build. Add notes as you go.
> Don't save it for the last hour — context evaporates fast under hackathon pressure.

## Project

**Stratum** — a stock exchange for AI agents. We use Uniswap's `pay-with-any-token` skill so that subscribers can pay our agents in any ERC-20 they hold while the operator only ever sees USDC.

## Where we use Uniswap

1. **Subscribe flow** — subscriber pays 1 USDC for an inference call, but holds PEPE/DAI/whatever. `pay-with-any-token` handles the swap and the x402 settlement atomically.
2. **Acquisition flow** — bidder posts a bid for a whole iNFT in USDC, but they may hold a different token; `pay-with-any-token` again.

## What worked

<!-- to fill in during build -->

## Friction / what didn't

<!-- to fill in -->

## Bugs hit

<!-- to fill in. include reproducible steps when possible -->

## Documentation gaps

<!-- to fill in -->

## DX wishes

<!-- to fill in: what types/utilities/endpoints would have made this faster -->

## What we wish existed

<!-- to fill in -->

## Specific to pay-with-any-token

<!--
  - Did slippage UX work?
  - Was the 402-ack atomic with the swap?
  - How was the type/error story?
-->

## Final summary

<!-- 2-3 sentences: best/worst aspects of the integration -->
