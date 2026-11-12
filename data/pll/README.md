# PLL 2019–2021

ESPN's PLL coverage starts in 2022, so the league's first three seasons live here as a curated results file, `2019-2021.csv`. `pnpm data:pll` builds them into season files the same way as the ESPN seasons, with weekends, labels and game types.

- **Source:** the Wikipedia season pages ([2019](https://en.wikipedia.org/wiki/2019_Premier_Lacrosse_League_season), [2020](https://en.wikipedia.org/wiki/2020_Premier_Lacrosse_League_season), [2021](https://en.wikipedia.org/wiki/2021_Premier_Lacrosse_League_season)), CC BY-SA 4.0. Schedules and results were transcribed from their schedule tables.
- **Checked:** each season's regular-season win–loss records match its published standings. A test (`scripts/pll-early.test.ts`) keeps it that way.
- **Game types** come from each table's own round labels:
  - numbered weeks are the regular season, and playoff rounds are `postseason`;
  - 2020 was played entirely as the bubble Championship Series, so it's all `tournament`;
  - exhibitions (the 2019 Draft Pick Game, All-Star games) are left out.
- **Columns:**
  - `date` and `time` are US Eastern, 24-hour.
  - `away` and `home` are franchise IDs. Sites were neutral, so `home` is just the second-listed team.
  - `overtime` is 1 or 0.
  - `round` is the source's label, kept for reference.
