"""Tests for BatteryParams validation and derived properties."""

import math

import pytest

from pricetaker.battery import BatteryParams


def test_valid_battery_properties():
    b = BatteryParams(power_mw=10.0, energy_mwh=20.0, eta_rt=0.81)
    assert b.eta_charge == pytest.approx(0.9)
    assert b.eta_discharge == pytest.approx(0.9)
    # Round trip returns eta_rt of the energy.
    assert b.eta_charge * b.eta_discharge == pytest.approx(0.81)
    assert b.soc_init_mwh == pytest.approx(10.0)
    assert b.usable_energy_mwh == pytest.approx(20.0)


def test_partial_soc_bounds():
    b = BatteryParams(
        power_mw=5.0, energy_mwh=10.0, soc_min_frac=0.1, soc_max_frac=0.9, soc_init_frac=0.5
    )
    assert b.soc_min_mwh == pytest.approx(1.0)
    assert b.soc_max_mwh == pytest.approx(9.0)
    assert b.usable_energy_mwh == pytest.approx(8.0)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"power_mw": -1.0, "energy_mwh": 10.0},
        {"power_mw": 0.0, "energy_mwh": 10.0},
        {"power_mw": 10.0, "energy_mwh": -5.0},
        {"power_mw": 10.0, "energy_mwh": 10.0, "eta_rt": 1.5},
        {"power_mw": 10.0, "energy_mwh": 10.0, "eta_rt": 0.0},
        {"power_mw": 10.0, "energy_mwh": 10.0, "deg_cost_eur_mwh": -1.0},
        # Inverted SoC bounds.
        {"power_mw": 10.0, "energy_mwh": 10.0, "soc_min_frac": 0.8, "soc_max_frac": 0.2},
        # Init outside bounds.
        {
            "power_mw": 10.0,
            "energy_mwh": 10.0,
            "soc_min_frac": 0.2,
            "soc_max_frac": 0.8,
            "soc_init_frac": 0.9,
        },
        # Fraction out of [0, 1].
        {"power_mw": 10.0, "energy_mwh": 10.0, "soc_max_frac": 1.5},
    ],
)
def test_validation_rejects_nonsense(kwargs):
    with pytest.raises(ValueError):
        BatteryParams(**kwargs)


def test_default_round_trip_efficiency():
    b = BatteryParams(power_mw=1.0, energy_mwh=1.0)
    assert b.eta_charge == pytest.approx(math.sqrt(0.86))
