"""Dispatch strategies.

Every strategy implements the :class:`~pricetaker.strategies.base.Strategy`
protocol and returns a :class:`~pricetaker.strategies.base.Dispatch`. The
strategies are:

* :class:`~pricetaker.strategies.perfect_foresight.PerfectForesight` — the LP
  ceiling that knows all future prices.
* :class:`~pricetaker.strategies.threshold.Threshold` — percentile-based
  charge/discharge with no foresight.
* :class:`~pricetaker.strategies.daily_topn.DailyTopN` — charge in the N
  cheapest hours of each day, discharge in the N most expensive.
* :class:`~pricetaker.strategies.rolling_horizon.RollingHorizon` — receding
  horizon MPC driven by a price forecast (stretch goal).
"""

from pricetaker.strategies.base import Dispatch, Strategy
from pricetaker.strategies.daily_topn import DailyTopN
from pricetaker.strategies.perfect_foresight import PerfectForesight
from pricetaker.strategies.rolling_horizon import RollingHorizon
from pricetaker.strategies.threshold import Threshold

__all__ = [
    "DailyTopN",
    "Dispatch",
    "PerfectForesight",
    "RollingHorizon",
    "Strategy",
    "Threshold",
]
