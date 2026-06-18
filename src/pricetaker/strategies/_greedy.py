"""Shared greedy simulator for the heuristic (no-LP) strategies.

The heuristics (:mod:`~pricetaker.strategies.threshold` and
:mod:`~pricetaker.strategies.daily_topn`) decide an *intention* for each step —
charge, discharge or idle — and then this module walks the battery forward in
time, clipping each action to the power and state-of-charge limits. Keeping the
feasibility logic here means each heuristic only has to express its intent.
"""

from __future__ import annotations

from enum import Enum

import numpy as np
import pandas as pd

from pricetaker.battery import BatteryParams
from pricetaker.strategies.base import (
    PRICE_COL,
    Dispatch,
    empty_dispatch_frame,
    infer_dt_hours,
)


class Action(Enum):
    """A per-step intention before feasibility clipping."""

    IDLE = 0
    CHARGE = 1
    DISCHARGE = 2


def simulate_greedy(
    prices: pd.Series,
    battery: BatteryParams,
    actions: np.ndarray,
    name: str,
) -> Dispatch:
    """Walk the battery forward, clipping each intended action to the limits.

    Args:
        prices: tz-aware price series (EUR/MWh).
        battery: the battery to dispatch.
        actions: an array of :class:`Action` values, one per timestep, aligned
            to ``prices``.
        name: label for the resulting dispatch.

    Returns:
        The feasible :class:`Dispatch`.
    """
    dt = infer_dt_hours(prices.index)  # type: ignore[arg-type]
    n = len(prices)
    eta_c = battery.eta_charge
    eta_d = battery.eta_discharge
    p_max = battery.power_mw
    soc_lo = battery.soc_min_mwh
    soc_hi = battery.soc_max_mwh

    charge = np.zeros(n)
    discharge = np.zeros(n)
    soc_path = np.zeros(n)

    soc = battery.soc_init_mwh
    for t in range(n):
        action = actions[t]
        if action == Action.CHARGE:
            # Charge power that exactly fills to soc_hi this step, capped at p_max.
            headroom_mwh = soc_hi - soc
            max_power = headroom_mwh / (eta_c * dt) if eta_c * dt > 0 else 0.0
            c = min(p_max, max(0.0, max_power))
            charge[t] = c
            soc += eta_c * c * dt
        elif action == Action.DISCHARGE:
            # Discharge power that exactly empties to soc_lo this step, capped at p_max.
            available_mwh = soc - soc_lo
            max_power = available_mwh * eta_d / dt if dt > 0 else 0.0
            d = min(p_max, max(0.0, max_power))
            discharge[t] = d
            soc -= d / eta_d * dt
        soc_path[t] = soc

    frame = empty_dispatch_frame(prices)
    frame["charge_mw"] = charge
    frame["discharge_mw"] = discharge
    frame["soc_mwh"] = soc_path
    frame[PRICE_COL] = prices.to_numpy(dtype=float)
    return Dispatch(frame=frame, dt_hours=dt, battery=battery, name=name)
