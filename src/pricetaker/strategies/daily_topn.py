"""Daily top-N strategy — the intuitive "buy low at night, sell high at peak".

For each calendar day (in the price series' own timezone), charge during the
``n`` cheapest steps and discharge during the ``n`` most expensive. State-of-
charge feasibility is handled by the shared greedy simulator, so on a day where
the battery cannot fit ``n`` full charge steps the later ones simply do less.

This is a very readable heuristic: it captures the daily price shape without any
optimisation, and sits between the threshold baseline and the LP ceiling.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pricetaker.battery import BatteryParams
from pricetaker.strategies._greedy import Action, simulate_greedy
from pricetaker.strategies.base import Dispatch


class DailyTopN:
    """Charge in the ``n`` cheapest steps of each day, discharge in the ``n`` priciest.

    Args:
        n: Number of steps per day to charge (and, separately, to discharge).
        name: Label for the dispatch.
    """

    def __init__(self, n: int = 4, name: str = "daily_topn") -> None:
        if n < 1:
            raise ValueError(f"n must be >= 1, got {n}")
        self.n = n
        self.name = name

    def run(self, prices: pd.Series, battery: BatteryParams) -> Dispatch:
        """Pick the cheapest/priciest steps per calendar day, then simulate.

        Args:
            prices: tz-aware price series (EUR/MWh).
            battery: the battery to dispatch.

        Returns:
            The resulting :class:`Dispatch`.
        """
        actions = np.full(len(prices), Action.IDLE, dtype=object)
        # Group by calendar day in the series' local timezone.
        day_labels = prices.index.normalize()
        positions = pd.Series(np.arange(len(prices)), index=prices.index)

        for _, day_positions in positions.groupby(day_labels):
            idx = day_positions.to_numpy()
            day_prices = prices.iloc[idx].to_numpy(dtype=float)
            k = min(self.n, len(idx))
            cheapest = idx[np.argsort(day_prices, kind="stable")[:k]]
            priciest = idx[np.argsort(day_prices, kind="stable")[-k:]]
            actions[cheapest] = Action.CHARGE
            actions[priciest] = Action.DISCHARGE

        return simulate_greedy(prices, battery, actions, self.name)
