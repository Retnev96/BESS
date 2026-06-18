"""Tests for the metrics arithmetic on a fixed, hand-checked dispatch."""

import pandas as pd
import pytest

from pricetaker.battery import BatteryParams
from pricetaker.metrics import compare, summarise
from pricetaker.strategies.base import PRICE_COL, Dispatch


def _fixed_dispatch(deg_cost=0.0):
    # Four hourly steps: charge 2 MWh at 10, idle, discharge 2 MWh at 60, idle.
    index = pd.date_range("2025-03-01", periods=4, freq="1h", tz="Europe/Vienna")
    frame = pd.DataFrame(
        {
            "charge_mw": [2.0, 0.0, 0.0, 0.0],
            "discharge_mw": [0.0, 0.0, 2.0, 0.0],
            "soc_mwh": [2.0, 2.0, 0.0, 0.0],
            PRICE_COL: [10.0, 30.0, 60.0, 30.0],
        },
        index=index,
    )
    battery = BatteryParams(power_mw=2.0, energy_mwh=4.0, eta_rt=1.0, deg_cost_eur_mwh=deg_cost)
    return Dispatch(frame=frame, dt_hours=1.0, battery=battery, name="fixed")


def test_revenue_and_throughput():
    summary = summarise(_fixed_dispatch())
    # Bought 2 MWh @ 10 = 20 cost; sold 2 MWh @ 60 = 120 income.
    assert summary.gross_revenue_eur == pytest.approx(100.0)
    assert summary.net_profit_eur == pytest.approx(100.0)
    assert summary.energy_charged_mwh == pytest.approx(2.0)
    assert summary.energy_discharged_mwh == pytest.approx(2.0)
    assert summary.throughput_mwh == pytest.approx(4.0)
    assert summary.avg_buy_price == pytest.approx(10.0)
    assert summary.avg_sell_price == pytest.approx(60.0)
    assert summary.spread_captured == pytest.approx(50.0)


def test_cycle_counting():
    summary = summarise(_fixed_dispatch())
    # Discharged 2 MWh against 4 MWh usable capacity => 0.5 equivalent cycles.
    assert summary.equivalent_full_cycles == pytest.approx(0.5)
    assert summary.revenue_per_cycle == pytest.approx(200.0)
    assert summary.revenue_per_mwh_capacity == pytest.approx(25.0)


def test_capacity_factor():
    summary = summarise(_fixed_dispatch())
    # Discharged 2 MWh; max over 4 hours at 2 MW is 8 MWh => 0.25.
    assert summary.capacity_factor == pytest.approx(0.25)


def test_degradation_cost_reduces_profit():
    summary = summarise(_fixed_dispatch(deg_cost=5.0))
    # 5 EUR/MWh on 2 MWh discharged = 10 EUR.
    assert summary.degradation_cost_eur == pytest.approx(10.0)
    assert summary.net_profit_eur == pytest.approx(90.0)


def test_compare_returns_tidy_frame():
    d = _fixed_dispatch()
    table = compare({"a": d, "b": d})
    assert list(table.index) == ["a", "b"]
    assert "net_profit_eur" in table.columns
    assert table.loc["a", "net_profit_eur"] == pytest.approx(100.0)
