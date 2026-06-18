"""Tests for the offline sample loader. No test here touches the network."""

import pandas as pd
import pytest

from pricetaker.data.sample import SAMPLE_ZONES, load_sample, synthesize_prices
from pricetaker.strategies.base import PRICE_COL, infer_dt_hours


@pytest.mark.parametrize("zone", SAMPLE_ZONES)
def test_sample_is_tz_aware_named_and_monotonic(zone):
    series = load_sample(zone)
    assert series.name == PRICE_COL
    assert isinstance(series.index, pd.DatetimeIndex)
    assert series.index.tz is not None
    assert series.index.is_monotonic_increasing
    assert len(series) > 0
    assert series.notna().all()


def test_sample_resolutions_differ():
    # AT is hourly, DE_LU is 15-minute — exercises resolution-agnostic code.
    assert infer_dt_hours(load_sample("AT").index) == pytest.approx(1.0)
    assert infer_dt_hours(load_sample("DE_LU").index) == pytest.approx(0.25)


def test_unknown_zone_raises():
    with pytest.raises(ValueError):
        load_sample("ZZ")


def test_synthesize_is_reproducible_and_has_negative_prices():
    a = synthesize_prices("DE_LU")
    b = synthesize_prices("DE_LU")
    pd.testing.assert_series_equal(a, b)
    # The synthesiser injects occasional negative prices on purpose.
    assert (a < 0).any()
