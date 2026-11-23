# ridge-runner-cbbtc
[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/tuyulsembilanenam672-cell/ridge-runner-cbbtc/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/tuyulsembilanenam672-cell/ridge-runner-cbbtc/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
Ridge Runner: a two-leg, flat-by-default BTC trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It buys an early confirmed up-move and rides it with a wide trailing stop (trend leg), and buys a sharp dip only once the fall has paused, exiting fast (dip leg). On the frozen dev window it made a net PnL of $35.89 with 1 trade, above the best baseline ($34.94).
## Run it
```sh
node cli/makefun.mjs grade-local --kit <kit> --bot <this repo> --driver process
```
---
<sub>Entered on [make.fun](https://make.fun/?ref=sq78y28z&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
