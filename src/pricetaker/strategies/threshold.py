"""Percentile-threshold strategy — the simple, no-foresight baseline.

Charge whenever the price is at or below a low percentile, discharge whenever it
is at or above a high percentile, idle otherwise. Power and state-of-charge
limits are respected greedily by the shared simulator. The percentiles are
computed either over the whole horizon or over a trailing rolling window (which
is more realistic, since a real operator only knows the past).

This baseline should noticeably underperform the perfect-foresight LP — that gap
is the value of foresight, and one of the points of the project.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pricetaker.battery import BatteryParams
from pricetaker.strategies._greedy import Action, simulate_greedy
from pricetaker.strategies.base import Dispatch


class Threshold:
    """Charge below the ``low_pct`` price percentile, discharge above ``high_pct``.

    Args:
        low_pct: Charge when price <= this percentile (0-100).
        high_pct: Discharge when price >= this percentile (0-100).
        window: Optional trailing window length (number of steps) over which to
            compute the percentiles. ``None`` (default) uses the whole horizon,
            which technically peeks at the future but is the simplest baseline.
        name: Label for the dispatch.
    """

    def __init__(
        self,
        low_pct: float = 25.0,
        high_pct: float = 75.0,
        window: int | None = None,
        name: str = "threshold",
    ) -> None:
        if not 0 <= low_pct < high_pct <= 100:
            raise ValueError(
                "require 0 <= low_pct < high_pct <= 100, got "
                f"low_pct={low_pct}, high_pct={high_pct}"
            )
        if window is not None and window < 1:
            raise ValueError(f"window must be >= 1 or None, got {window}")
        self.low_pct = low_pct
        self.high_pct = high_pct
        self.window = window
        self.name = name

    def run(self, prices: pd.Series, battery: BatteryParams) -> Dispatch:
        """Decide charge/discharge intents from price percentiles, then simulate.

        Args:
            prices: tz-aware price series (EUR/MWh).
            battery: the battery to dispatch.

        Returns:
            The resulting :class:`Dispatch`.
        """
        price = prices.to_numpy(dtype=float)
        low, high = self._thresholds(price)
        actions = np.full(len(price), Action.IDLE, dtype=object)
        actions[price <= low] = Action.CHARGE
        actions[price >= high] = Action.DISCHARGE
        return simulate_greedy(prices, battery, actions, self.name)

    def _thresholds(self, price: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Compute per-step low/high price thresholds.

        Returns arrays (one entry per step) so a rolling window can vary the
        thresholds over time; for whole-horizon mode they are constant.
        """
        if self.window is None:
            low = np.full_like(price, np.percentile(price, self.low_pct))
            high = np.full_like(price, np.percentile(price, self.high_pct))
            return low, high

        series = pd.Series(price)
        roll = series.rolling(self.window, min_periods=1)
        low = roll.quantile(self.low_pct / 100.0).to_numpy()
        high = roll.quantile(self.high_pct / 100.0).to_numpy()
        return low, high
