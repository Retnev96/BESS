r"""Command-line entry point: run strategies and print a metrics table.

Examples::

    # Run every strategy on the bundled Austrian sample data.
    pricetaker run --zone AT

    # Pick a battery and a subset of strategies.
    pricetaker run --zone DE_LU --power 10 --energy 20 \\
        --strategies perfect_foresight daily_topn

    # Use live ENTSO-E data (requires a token; hits the network).
    pricetaker run --live --zone AT --start 2025-03-01 --end 2025-03-08
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable

import pandas as pd

from pricetaker.battery import BatteryParams
from pricetaker.data.sample import SAMPLE_ZONES, load_sample
from pricetaker.metrics import compare
from pricetaker.strategies import (
    DailyTopN,
    PerfectForesight,
    RollingHorizon,
    Strategy,
    Threshold,
)

#: Registry mapping CLI strategy names to zero-arg constructors (defaults).
STRATEGY_FACTORIES: dict[str, Callable[[], Strategy]] = {
    "perfect_foresight": PerfectForesight,
    "threshold": Threshold,
    "daily_topn": DailyTopN,
    "rolling_horizon": RollingHorizon,
}


def _load_prices(args: argparse.Namespace) -> pd.Series:
    """Load prices from the sample data or the live ENTSO-E API."""
    if args.live:
        from pricetaker.data.entsoe import get_day_ahead_prices

        if not (args.start and args.end):
            raise SystemExit("--live requires --start and --end")
        return get_day_ahead_prices(args.zone, args.start, args.end, token=args.token)
    return load_sample(args.zone)


def _build_battery(args: argparse.Namespace) -> BatteryParams:
    """Construct the battery from CLI arguments."""
    return BatteryParams(
        power_mw=args.power,
        energy_mwh=args.energy,
        eta_rt=args.eta_rt,
        deg_cost_eur_mwh=args.deg_cost,
    )


def _run(args: argparse.Namespace) -> int:
    """Execute the ``run`` subcommand."""
    prices = _load_prices(args)
    battery = _build_battery(args)

    chosen = args.strategies or list(STRATEGY_FACTORIES)
    dispatches = {}
    for name in chosen:
        if name not in STRATEGY_FACTORIES:
            raise SystemExit(f"unknown strategy {name!r}; choose from {list(STRATEGY_FACTORIES)}")
        strategy = STRATEGY_FACTORIES[name]()
        dispatches[name] = strategy.run(prices, battery)

    table = compare(dispatches).T
    horizon = f"{prices.index[0].date()} .. {prices.index[-1].date()}"
    print(f"\nZone: {args.zone}   Horizon: {horizon}   Steps: {len(prices)}")
    print(f"Battery: {battery.power_mw} MW / {battery.energy_mwh} MWh, eta_rt={battery.eta_rt}\n")
    with pd.option_context("display.float_format", lambda v: f"{v:,.2f}"):
        print(table)
    return 0


def build_parser() -> argparse.ArgumentParser:
    """Construct the top-level argument parser."""
    parser = argparse.ArgumentParser(
        prog="pricetaker",
        description="Simulate battery price arbitrage against day-ahead prices.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="run strategies and print a metrics table")
    run.add_argument(
        "--zone",
        default="AT",
        help=f"bidding zone (sample zones: {', '.join(SAMPLE_ZONES)})",
    )
    run.add_argument("--power", type=float, default=10.0, help="power limit (MW)")
    run.add_argument("--energy", type=float, default=20.0, help="energy capacity (MWh)")
    run.add_argument("--eta-rt", type=float, default=0.86, help="round-trip efficiency")
    run.add_argument(
        "--deg-cost",
        type=float,
        default=0.0,
        help="degradation cost (EUR per MWh discharged)",
    )
    run.add_argument(
        "--strategies",
        nargs="+",
        choices=list(STRATEGY_FACTORIES),
        help="which strategies to run (default: all)",
    )
    run.add_argument("--live", action="store_true", help="fetch live ENTSO-E data")
    run.add_argument("--start", help="start date for --live (e.g. 2025-03-01)")
    run.add_argument("--end", help="end date for --live (e.g. 2025-03-08)")
    run.add_argument("--token", help="ENTSO-E token (else ENTSOE_API_TOKEN)")
    run.set_defaults(func=_run)
    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point.

    Args:
        argv: argument list (defaults to ``sys.argv[1:]``).

    Returns:
        Process exit code.
    """
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
