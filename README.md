# 🔋 pricetaker

[![CI](https://github.com/retnev96/bess/actions/workflows/ci.yml/badge.svg)](https://github.com/retnev96/bess/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**pricetaker** is a clean, educational simulator of a **battery energy storage
system (BESS)** doing **price arbitrage** against European day-ahead electricity
prices. It pulls prices from the [ENTSO-E Transparency Platform][entsoe],
simulates the battery charging when power is cheap and discharging when it is
expensive under several dispatch strategies, and reports the economics — revenue,
cycles, captured spread — in a CLI and an interactive Streamlit app.

The name is the economics term for an actor too small to influence the price.
That is exactly our modelling assumption: the battery **takes** prices as given
and never moves the market.

> ⚠️ **Not a trading bot, and not financial advice.** This is a teaching tool.
> It assumes perfect price knowledge in its best-case strategy, ignores grid
> fees, taxes, ancillary-service revenue and market access costs, and makes no
> claim about real-world profitability.

![screenshot placeholder](docs/screenshot.png)
<!-- TODO: drop a screenshot/GIF of the Streamlit app here. -->

---

## Quickstart

```bash
# 1. Clone and create an isolated environment (uv shown; plain venv works too).
git clone https://github.com/retnev96/bess.git pricetaker
cd pricetaker
uv venv && source .venv/bin/activate

# 2. Install. The base install runs everything offline (sample data + CLI).
uv pip install -e ".[dev,viz]"

# 3. Run every strategy on the bundled (synthetic) Austrian sample data.
pricetaker run --zone AT

# 4. Launch the interactive app (works with no token).
streamlit run app/streamlit_app.py
```

No token is needed for any of the above — the project ships ~2 weeks of bundled
sample data for `AT` (hourly) and `DE_LU` (15-minute).

### Using real ENTSO-E data

```bash
uv pip install -e ".[entsoe]"      # adds entsoe-py + python-dotenv
cp .env.example .env               # then paste your token into .env
pricetaker run --live --zone AT --start 2025-03-01 --end 2025-03-08
```

**Getting a token (free):** register at the [ENTSO-E Transparency
Platform][entsoe], then email `transparency@entsoe.eu` asking them to enable
API access for your account. Put the token in `.env` as
`ENTSOE_API_TOKEN=...`. The `.env` file is gitignored — never commit it.

---

## A worked example

```python
from pricetaker.battery import BatteryParams
from pricetaker.data.sample import load_sample
from pricetaker.metrics import compare
from pricetaker.strategies import PerfectForesight, Threshold, DailyTopN

prices = load_sample("AT")                       # tz-aware EUR/MWh series
battery = BatteryParams(power_mw=10, energy_mwh=20, eta_rt=0.86)

dispatches = {
    "perfect_foresight": PerfectForesight().run(prices, battery),
    "daily_topn":        DailyTopN(n=4).run(prices, battery),
    "threshold":         Threshold(low_pct=25, high_pct=75).run(prices, battery),
}

print(compare(dispatches)[["net_profit_eur", "equivalent_full_cycles"]])
```

The perfect-foresight LP will always come out on top — it is the ceiling. The
gap below it is what the heuristics leave on the table.

---

## How arbitrage works (the actual point of this project)

A storage arbitrageur makes money on one thing: the **price spread** between
when it buys (charges) and when it sells (discharges). But three frictions
decide whether a given spread is actually worth capturing.

### 1. Round-trip efficiency sets the break-even spread

No battery is lossless. With round-trip efficiency `η_rt` (default `0.86`), you
get back only 86 % of the energy you put in. We split the loss symmetrically:
each direction keeps `√η_rt ≈ 0.927`.

To break even, the price you sell at must clear the price you buy at **plus the
efficiency loss**. Buy 1 MWh at price `p_buy`; you can later sell only `η_rt`
MWh. Ignoring degradation, you profit only when

```
p_sell · η_rt  >  p_buy        ⇒        p_sell / p_buy  >  1 / η_rt ≈ 1.16
```

So with an 86 % round-trip battery you need the high price to be **at least ~16 %
above** the low price before you even break even. A 5 % daily price wiggle is not
arbitrageable; a night-to-evening doubling very much is. This is why round-trip
efficiency is the single most important number in storage economics.

### 2. Cycles cost money (degradation)

Every charge/discharge cycle ages the cells. We model this as a simple
`deg_cost_eur_mwh` charged per MWh discharged. It raises the break-even spread
further: now you need the spread to beat *both* the efficiency loss *and* the
wear cost. Set it to zero to ignore ageing, or to a realistic figure (often a
few EUR/MWh) to see how it suppresses marginal, low-spread cycles. We report
**equivalent full cycles** (discharged energy ÷ usable capacity) so you can see
how hard a strategy is working the battery.

### 3. Perfect foresight is only a *ceiling*

The `PerfectForesight` strategy is a linear program that knows every future
price and schedules the globally optimal charge/discharge plan. **No real
strategy can beat it** — that is precisely why it is useful: it is the
yardstick. A real operator does not know tomorrow's prices, so the interesting
question is how close a *foresight-free* heuristic gets:

| Strategy            | Foresight            | Typical result                    |
| ------------------- | -------------------- | --------------------------------- |
| `perfect_foresight` | all future prices    | the ceiling (upper bound)         |
| `rolling_horizon`   | a price *forecast*   | between heuristics and ceiling    |
| `daily_topn`        | none (per-day shape) | captures most of the daily swing  |
| `threshold`         | none (percentiles)   | the simple baseline               |

The distance between `rolling_horizon` and `perfect_foresight` is, quite
literally, **the value of a better forecast**.

### 4. Negative prices flip the logic

In renewable-heavy markets, prices regularly go **negative**: there is more wind
and solar than demand, and producers pay to offload power. When the price is
negative, charging is no longer a cost — **you get paid to consume**. The LP
exploits this automatically: you will see it charge through negative-price
windows even if it never discharges that energy at a profit, because being paid
to fill up is itself the trade. The bundled sample data injects occasional
negative midday prices so you can watch this happen. It is one of the most
counterintuitive — and real — features of modern power markets.

---

## Strategies in detail

- **`PerfectForesight`** — LP over the whole horizon. Maximises
  `Σ price·(discharge − charge)·dt − deg·Σ discharge·dt` subject to power, SoC
  and storage-dynamics constraints. Optional terminal condition (`free` vs.
  `end SoC ≥ start SoC`) so multi-day runs are not gamed by draining the battery
  at the end. Default is `free`.
- **`Threshold`** — charge below a low price percentile, discharge above a high
  one. Percentiles over the whole horizon or a trailing window. The honest
  no-foresight baseline.
- **`DailyTopN`** — each calendar day, charge in the `n` cheapest steps and
  discharge in the `n` priciest. Intuitive "buy at night, sell at the peak".
- **`RollingHorizon`** *(stretch)* — receding-horizon MPC: re-solve the LP over
  a moving window using a price **forecast** (default: yesterday repeats),
  commit the first step, advance. Demonstrates the value of forecasting.

All strategies share one interface (`strategy.run(prices, battery) -> Dispatch`)
and a single result type, so they are fully interchangeable.

---

## Time resolution

ENTSO-E day-ahead prices are **not always hourly** — several zones moved to a
15-minute market time unit (MTU) during 2025. pricetaker never assumes a step
length: it infers the resolution from the price index and threads `dt` (in
hours) through every energy and revenue calculation. The bundled `DE_LU` sample
is 15-minute on purpose, to keep this path exercised.

---

## Project layout

```
src/pricetaker/
  battery.py             # BatteryParams dataclass + validation
  data/                  # sample loader (offline) + ENTSO-E fetch (live, cached)
  strategies/            # base interface + LP + heuristics + MPC
  metrics.py             # revenue, cycles, throughput, spread...
  plotting.py            # plotly figures (no app framework imported)
  cli.py                 # `pricetaker run ...`
app/streamlit_app.py     # interactive demo
examples/walkthrough.ipynb
tests/                   # offline, no network
```

---

## Development

```bash
uv pip install -e ".[dev]"
ruff check . && ruff format --check .
pytest
pre-commit install        # optional: run lint/format on every commit
```

CI runs ruff + pytest on Python 3.11 and 3.12 and **never touches the network**.

## Non-goals (v1)

- Not a bidding-curve / market-clearing model — we are a price taker.
- No intraday or balancing markets (hooks left for later).
- No multi-asset portfolio optimisation.

## License

[MIT](LICENSE).

[entsoe]: https://transparency.entsoe.eu/
