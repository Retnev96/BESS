"""Tests for the dispatch strategies.

Covers an analytic small-case check for the LP, the no-simultaneous-action
property, the "LP is the ceiling" guarantee, and SoC feasibility for every
strategy on the bundled sample data.
"""

import numpy as np
import pandas as pd
import pytest

from pricetaker.battery import BatteryParams
from pricetaker.data.sample import load_sample
from pricetaker.metrics import summarise
from pricetaker.strategies import DailyTopN, PerfectForesight, RollingHorizon, Threshold
from pricetaker.strategies.base import PRICE_COL

HOURLY_STRATEGIES = [
    PerfectForesight(),
    Threshold(),
    DailyTopN(n=2),
    RollingHorizon(horizon_hours=24),
]


def _series(prices, start="2025-03-01", freq="1h"):
    index = pd.date_range(
        start=pd.Timestamp(start, tz="Europe/Vienna"), periods=len(prices), freq=freq
    )
    return pd.Series(prices, index=index, name=PRICE_COL)


def test_perfect_foresight_matches_analytic_optimum():
    # Lossless 1 MW / 1 MWh battery, starting empty, on a clean buy-low/sell-high
    # price pattern. Each cycle captures the full 40 EUR spread.
    prices = _series([10.0, 50.0, 10.0, 50.0])
    battery = BatteryParams(power_mw=1.0, energy_mwh=1.0, eta_rt=1.0, soc_init_frac=0.0)
    dispatch = PerfectForesight().run(prices, battery)
    profit = summarise(dispatch).net_profit_eur
    # Buy 1 MWh at 10 then sell at 50, twice: (-10 + 50) * 2 = 80.
    assert profit == pytest.approx(80.0, abs=1e-6)


def test_perfect_foresight_charges_on_negative_prices():
    # When the price is negative the LP should be paid to charge.
    prices = _series([-20.0, 30.0])
    battery = BatteryParams(power_mw=1.0, energy_mwh=1.0, eta_rt=1.0, soc_init_frac=0.0)
    dispatch = PerfectForesight().run(prices, battery)
    assert dispatch.charge_mw.iloc[0] > 0.0


def test_lp_never_charges_and_discharges_simultaneously():
    prices = load_sample("AT")
    battery = BatteryParams(power_mw=10.0, energy_mwh=20.0)
    dispatch = PerfectForesight().run(prices, battery)
    both = (dispatch.charge_mw > 1e-6) & (dispatch.discharge_mw > 1e-6)
    assert not both.any()


def test_lp_is_the_ceiling():
    prices = load_sample("AT")
    battery = BatteryParams(power_mw=10.0, energy_mwh=20.0)
    lp_profit = summarise(PerfectForesight().run(prices, battery)).net_profit_eur
    for strategy in (Threshold(), DailyTopN(n=4), RollingHorizon(horizon_hours=48)):
        heuristic = summarise(strategy.run(prices, battery)).net_profit_eur
        assert heuristic <= lp_profit + 1e-6, f"{strategy.name} beat the LP ceiling"


@pytest.mark.parametrize("strategy", HOURLY_STRATEGIES, ids=lambda s: s.name)
def test_soc_stays_within_bounds(strategy):
    prices = load_sample("AT")
    battery = BatteryParams(power_mw=10.0, energy_mwh=20.0, soc_min_frac=0.05, soc_max_frac=0.95)
    dispatch = strategy.run(prices, battery)
    soc = dispatch.soc_mwh.to_numpy()
    assert soc.min() >= battery.soc_min_mwh - 1e-6
    assert soc.max() <= battery.soc_max_mwh + 1e-6
    assert (dispatch.charge_mw >= -1e-9).all()
    assert (dispatch.discharge_mw >= -1e-9).all()


def test_strategies_handle_15_minute_resolution():
    # DE_LU sample is 15-minute; dispatch should infer dt=0.25 and stay feasible.
    prices = load_sample("DE_LU")
    battery = BatteryParams(power_mw=10.0, energy_mwh=20.0)
    dispatch = PerfectForesight().run(prices, battery)
    assert dispatch.dt_hours == pytest.approx(0.25)
    assert np.isfinite(summarise(dispatch).net_profit_eur)
