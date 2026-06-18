"""Bundled offline sample prices, plus the synthesiser that generates them.

The project must run end to end — and CI must pass — with no ENTSO-E token and
no network. To make that possible we ship a small parquet file per zone under
``_sample_data/``. If a real token is available you can regenerate these from
real prices; otherwise they are **synthetic**: a realistic diurnal curve with
weekly seasonality, noise and the occasional negative midday price. The data is
clearly labelled synthetic so nobody mistakes it for the real market.

To regenerate the bundled files, run::

    python -m pricetaker.data.sample

The two bundled zones deliberately differ in resolution to exercise the
resolution-agnostic code: ``AT`` is hourly, ``DE_LU`` is 15-minute (mirroring
the 2025 move to a 15-minute market time unit in several zones).
"""

from __future__ import annotations

from importlib import resources
from pathlib import Path

import numpy as np
import pandas as pd

from pricetaker.strategies.base import PRICE_COL

#: Zones bundled as offline sample data.
SAMPLE_ZONES: tuple[str, ...] = ("AT", "DE_LU")

#: Default timezone for the sample data (Central European Time covers AT/DE).
_SAMPLE_TZ = "Europe/Vienna"

#: Per-zone synthesis settings: (resolution in minutes, base price, RNG seed).
_ZONE_CONFIG: dict[str, tuple[int, float, int]] = {
    "AT": (60, 85.0, 42),
    "DE_LU": (15, 78.0, 7),
}


def _sample_path(zone: str) -> Path:
    """Return the on-disk path of a bundled sample parquet file."""
    return Path(str(resources.files("pricetaker.data") / "_sample_data" / f"{zone}.parquet"))


def synthesize_prices(
    zone: str = "AT",
    start: str = "2025-03-01",
    days: int = 14,
) -> pd.Series:
    """Generate a synthetic but realistic day-ahead price series.

    The shape combines a twice-daily peak (morning ramp and evening peak), a
    midday solar dip that occasionally goes negative, a weekday/weekend level
    difference, and Gaussian noise. It is *not* real market data.

    Args:
        zone: A key in :data:`SAMPLE_ZONES` (sets resolution, level and seed).
        start: First day (local date string).
        days: Number of days to generate.

    Returns:
        A tz-aware ``Series`` named :data:`PRICE_COL` in EUR/MWh.
    """
    if zone not in _ZONE_CONFIG:
        raise ValueError(f"unknown sample zone {zone!r}; choose from {SAMPLE_ZONES}")
    res_min, base, seed = _ZONE_CONFIG[zone]
    rng = np.random.default_rng(seed)

    index = pd.date_range(
        start=pd.Timestamp(start, tz=_SAMPLE_TZ),
        periods=int(days * 24 * 60 / res_min),
        freq=f"{res_min}min",
    )
    hour = index.hour + index.minute / 60.0
    hour_arr = hour.to_numpy(dtype=float)

    # Two daily humps (morning ~08:00, evening ~19:00) and a midday solar dip.
    morning = 22.0 * np.exp(-0.5 * ((hour_arr - 8.0) / 2.0) ** 2)
    evening = 38.0 * np.exp(-0.5 * ((hour_arr - 19.0) / 2.0) ** 2)
    solar_dip = -30.0 * np.exp(-0.5 * ((hour_arr - 13.0) / 2.5) ** 2)

    # Weekends sit a bit lower (less industrial demand).
    is_weekend = index.dayofweek.to_numpy() >= 5
    weekend_offset = np.where(is_weekend, -12.0, 0.0)

    noise = rng.normal(0.0, 6.0, size=len(index))
    price = base + morning + evening + solar_dip + weekend_offset + noise

    # Occasionally push a sunny weekend midday step below zero — a real feature
    # of renewable-heavy markets that flips the arbitrage logic.
    deep_dip = is_weekend & (np.abs(hour_arr - 13.0) < 1.5)
    price = np.where(deep_dip, price - 25.0, price)

    series = pd.Series(np.round(price, 2), index=index, name=PRICE_COL)
    series.index.name = "timestamp"
    return series


def load_sample(zone: str = "AT") -> pd.Series:
    """Load a bundled offline price series.

    Args:
        zone: One of :data:`SAMPLE_ZONES`.

    Returns:
        A tz-aware ``Series`` named :data:`PRICE_COL` in EUR/MWh, with a
        monotonically increasing index.

    Raises:
        ValueError: If ``zone`` is not a bundled sample zone.
        FileNotFoundError: If the bundled parquet is missing (regenerate it with
            ``python -m pricetaker.data.sample``).
    """
    if zone not in SAMPLE_ZONES:
        raise ValueError(f"unknown sample zone {zone!r}; choose from {SAMPLE_ZONES}")
    path = _sample_path(zone)
    if not path.exists():
        raise FileNotFoundError(
            f"bundled sample data for {zone!r} not found at {path}; "
            "regenerate with `python -m pricetaker.data.sample`"
        )
    frame = pd.read_parquet(path)
    series = frame[PRICE_COL]
    series.name = PRICE_COL
    return series


def _regenerate_all() -> None:
    """Write a fresh synthetic parquet for every sample zone."""
    out_dir = Path(__file__).parent / "_sample_data"
    out_dir.mkdir(parents=True, exist_ok=True)
    for zone in SAMPLE_ZONES:
        series = synthesize_prices(zone)
        series.to_frame().to_parquet(out_dir / f"{zone}.parquet")
        print(f"wrote {zone}: {len(series)} rows -> {out_dir / f'{zone}.parquet'}")


if __name__ == "__main__":
    _regenerate_all()
