# Circle of Parity

[![CI](https://github.com/mkeegan27/sports-parity/actions/workflows/ci.yml/badge.svg)](https://github.com/mkeegan27/sports-parity/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)

_Working title._ An animated, interactive tracker for a sports league's **circle of parity**: a single loop through every team in which each team beat the next one. In graph terms, it's a Hamiltonian cycle in the directed graph of wins.

It starts with the NFL. The app shows how close the season is to closing the circle and which upcoming games could close it, and it lets you play out scenarios to see how the circle could form.

## Repository layout

| Path                | What it is                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/core`     | League-agnostic data model and graph algorithms. Pure TypeScript that runs in browser or Node. |
| `packages/adapters` | Data-source adapters that emit normalized games, plus a reconciler.                            |
| `apps/web`          | The site: React UI, WebGL ring renderer and an accessible overlay.                             |
| `apps/ingest`       | Scheduled Cloudflare Worker that fetches and publishes league data.                            |
| `scripts`           | Backfill, benchmarks and fixture generation.                                                   |

## Development

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm data:nfl   # fetch and validate NFL seasons
pnpm dev        # web app, also served on your LAN for phone testing
pnpm test
pnpm lint
pnpm typecheck
```

## Data

NFL schedules, results and team colors come from [nflverse](https://github.com/nflverse) (CC BY 4.0). Generated data files are not committed; run `pnpm data:nfl` to build them.

## License

[MIT](LICENSE)
