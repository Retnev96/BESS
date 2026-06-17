"""Live day-ahead prices from the ENTSO-E Transparency Platform, with caching.

This module is the only place that talks to the network, and it is kept out of
CI. ``entsoe-py`` and ``python-dotenv`` are optional dependencies (install with
``pip install -e ".[entsoe]"``) and are imported lazily so the rest of the
package works without them.

Get a token: register at https://transparency.entsoe.eu/, then email
``transparency@entsoe.eu`` to have API access enabled. Put it in a ``.env``
file as ``ENTSOE_API_TOKEN=...`` (never commit it).

Resolution note: ENTSO-E day-ahead is no longer always hourly — several zones
moved to a 15-minute market time unit during 2025. We infer the resolution from
the returned index and stash it in ``series.attrs["resolution"]`` so downstream
code uses the real ``dt`` rather than assuming one hour.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pandas as pd

from pricetaker.strategies.base import PRICE_COL, infer_dt_hours

#: Default on-disk cache directory (gitignored).
DEFAULT_CACHE_DIR = Path(".cache") / "entsoe"


def _resolve_token(token: str | None) -> str:
    """Return the API token from the argument or the environment.

    Args:
        token: An explicit token, or ``None`` to read ``ENTSOE_API_TOKEN``.

    Returns:
        The token string.

    Raises:
        RuntimeError: If no token is available.
    """
    if token:
        return token
    # Load a local .env if python-dotenv is installed; ignore if absent.
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass
    env_token = os.environ.get("ENTSOE_API_TOKEN")
    if not env_token:
        raise RuntimeError(
            "No ENTSO-E token found. Pass token=... or set ENTSOE_API_TOKEN (see .env.example)."
        )
    return env_token


def _cache_key(zone: str, start: pd.Timestamp, end: pd.Timestamp) -> str:
    """Build a stable cache filename stem for a query."""
    raw = f"{zone}|{start.isoformat()}|{end.isoformat()}"
    digest = hashlib.sha1(raw.encode()).hexdigest()[:12]
    return f"{zone}_{start.date()}_{end.date()}_{digest}"


def get_day_ahead_prices(
    zone: str,
    start: pd.Timestamp | str,
    end: pd.Timestamp | str,
    token: str | None = None,
    cache: bool = True,
    cache_dir: Path | None = None,
) -> pd.Series:
    """Fetch day-ahead prices for a bidding zone, with an on-disk cache.

    Wraps ``EntsoePandasClient.query_day_ahead_prices``. The result is cached to
    parquet keyed by (zone, start, end); a cached file is reused on the next call
    with the same arguments so you do not burn API rate limits.

    Args:
        zone: An entsoe-py zone code (e.g. ``"AT"``, ``"DE_LU"``, ``"NL"``).
        start: Start timestamp (tz-aware, or a string parseable by pandas).
        end: End timestamp (tz-aware, or a string parseable by pandas).
        token: ENTSO-E API token; falls back to ``ENTSOE_API_TOKEN``.
        cache: Whether to read/write the parquet cache.
        cache_dir: Override for the cache directory.

    Returns:
        A tz-aware ``Series`` named :data:`PRICE_COL` in EUR/MWh, indexed by
        period start. The inferred resolution is stored in
        ``series.attrs["resolution"]`` as a :class:`pandas.Timedelta`.
    """
    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end)
    cache_dir = cache_dir or DEFAULT_CACHE_DIR
    cache_path = cache_dir / f"{_cache_key(zone, start_ts, end_ts)}.parquet"

    if cache and cache_path.exists():
        return _load_cached(cache_path)

    token = _resolve_token(token)

    # Imported lazily so the package works without the optional dependency.
    from entsoe import EntsoePandasClient

    client = EntsoePandasClient(api_key=token)
    raw = client.query_day_ahead_prices(zone, start=start_ts, end=end_ts)

    series = raw.rename(PRICE_COL).sort_index()
    series.index.name = "timestamp"
    series = _attach_resolution(series)

    if cache:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        series.to_frame().to_parquet(cache_path)

    return series


def _attach_resolution(series: pd.Series) -> pd.Series:
    """Infer the timestep and stash it in ``series.attrs['resolution']``."""
    dt_hours = infer_dt_hours(series.index)  # type: ignore[arg-type]
    series.attrs["resolution"] = pd.Timedelta(hours=dt_hours)
    return series


def _load_cached(path: Path) -> pd.Series:
    """Load a cached parquet back into a named, resolution-tagged series."""
    series = pd.read_parquet(path)[PRICE_COL]
    series.name = PRICE_COL
    return _attach_resolution(series)
