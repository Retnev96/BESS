"""Common strategy interface and the :class:`Dispatch` result type.

A strategy maps a price series and a battery to a *dispatch*: a per-timestep
schedule of charge power, discharge power and resulting state of charge. All
strategies share the same interface so they are interchangeable in the CLI,
the app and the tests.

A note on time resolution: ENTSO-E day-ahead prices are *not* always hourly.
Several zones moved to a 15-minute market time unit (MTU) during 2025, so we
infer the step length from the index and thread it through every calculation
as ``dt_hours`` rather than hard-coding ``1.0``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import pandas as pd

from pricetaker.battery import BatteryParams

#: Canonical name for the price column / series throughout the package.
PRICE_COL = "price_eur_mwh"


def infer_dt_hours(index: pd.DatetimeIndex) -> float:
    """Infer the timestep length, in hours, from a datetime index.

    The index is assumed to be regularly spaced (day-ahead prices are). We take
    the most common gap between consecutive timestamps so that a stray gap (for
    example a missing MTU) does not change the inferred resolution.

    Args:
        index: A tz-aware, monotonically increasing datetime index with at
            least two entries.

    Returns:
        The step length in hours (e.g. ``1.0`` for hourly, ``0.25`` for 15 min).

    Raises:
        ValueError: If the index has fewer than two entries.
    """
    if len(index) < 2:
        raise ValueError("need at least two timestamps to infer a resolution")
    deltas = index.to_series().diff().dropna()
    most_common = deltas.mode().iloc[0]
    return most_common.total_seconds() / 3600.0


@dataclass
class Dispatch:
    """The result of running a strategy.

    Attributes:
        frame: A tz-aware DataFrame indexed at the price resolution with
            columns ``charge_mw``, ``discharge_mw``, ``soc_mwh`` and
            ``price_eur_mwh``. ``charge_mw`` and ``discharge_mw`` are
            non-negative and never both positive in the same step.
        dt_hours: The timestep length in hours.
        battery: The battery the dispatch was computed for.
        name: A human-readable label for the strategy (used in plots/tables).
    """

    frame: pd.DataFrame
    dt_hours: float
    battery: BatteryParams
    name: str = "dispatch"

    @property
    def prices(self) -> pd.Series:
        """The price series the dispatch was computed against (EUR/MWh)."""
        return self.frame[PRICE_COL]

    @property
    def charge_mw(self) -> pd.Series:
        """Charge power per step (MW, non-negative)."""
        return self.frame["charge_mw"]

    @property
    def discharge_mw(self) -> pd.Series:
        """Discharge power per step (MW, non-negative)."""
        return self.frame["discharge_mw"]

    @property
    def soc_mwh(self) -> pd.Series:
        """State of charge at the end of each step (MWh)."""
        return self.frame["soc_mwh"]


@runtime_checkable
class Strategy(Protocol):
    """Protocol implemented by every dispatch strategy.

    A strategy is any object exposing a ``name`` and a ``run`` method. We use a
    runtime-checkable :class:`typing.Protocol` rather than an ABC so that even a
    bare function-like object satisfies the interface, keeping the strategies
    decoupled and easy to test.
    """

    name: str

    def run(self, prices: pd.Series, battery: BatteryParams) -> Dispatch:
        """Compute a dispatch for ``prices`` and ``battery``.

        Args:
            prices: A tz-aware ``Series`` of prices in EUR/MWh indexed by period
                start. Should be named :data:`PRICE_COL`.
            battery: The battery to dispatch.

        Returns:
            The resulting :class:`Dispatch`.
        """
        ...


def empty_dispatch_frame(prices: pd.Series) -> pd.DataFrame:
    """Build a zeroed dispatch frame aligned to ``prices``.

    Args:
        prices: The price series to align to.

    Returns:
        A DataFrame with ``charge_mw``, ``discharge_mw``, ``soc_mwh`` columns
        initialised to zero plus the ``price_eur_mwh`` column.
    """
    frame = pd.DataFrame(index=prices.index)
    frame["charge_mw"] = 0.0
    frame["discharge_mw"] = 0.0
    frame["soc_mwh"] = 0.0
    frame[PRICE_COL] = prices.to_numpy()
    return frame
