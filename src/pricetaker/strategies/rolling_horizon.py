"""Rolling-horizon MPC (stretch goal) — the value of forecasting, made visible.

This strategy mimics how a real operator runs: at each step it solves the
perfect-foresight LP, but only over a finite look-ahead *window* and using a
price **forecast** rather than the true future. It commits just the first
step's action, advances one step, updates the state of charge, and re-solves.

Because the forecast is imperfect, the realised revenue sits *between* the naive
heuristics and the perfect-foresight ceiling — which is exactly the lesson:
better forecasts are worth money, but never as much as clairvoyance.

The default forecaster is "yesterday repeats" (daily persistence): the forecast
for a given time is the actual price 24 hours earlier. For the first day, where
no prior day exists, it falls back to the known prices.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable

import numpy as np
import pandas as pd

from pricetaker.battery import BatteryParams
from pricetaker.strategies.base import (
    PRICE_COL,
    Dispatch,
    empty_dispatch_frame,
    infer_dt_hours,
)
from pricetaker.strategies.perfect_foresight import PerfectForesight

#: A forecaster maps (true prices, dt_hours) -> forecast prices of equal length.
Forecaster = Callable[[pd.Series, float], pd.Series]


def persistence_daily(prices: pd.Series, dt_hours: float) -> pd.Series:
    """Daily-persistence forecast: each price is predicted from 24h earlier.

    Args:
        prices: the true price series.
        dt_hours: timestep length in hours.

    Returns:
        A forecast series of the same length/index. The first day (which has no
        prior day to copy) falls back to the true prices.
    """
    steps_per_day = int(round(24.0 / dt_hours))
    forecast = prices.shift(steps_per_day)
    forecast.iloc[:steps_per_day] = prices.iloc[:steps_per_day].to_numpy()
    return forecast


class RollingHorizon:
    """Receding-horizon MPC: re-solve the LP on a forecast, commit one step.

    Args:
        horizon_hours: Length of the look-ahead window in hours.
        forecaster: Function producing a price forecast (default daily
            persistence). Swap in your own to study forecast quality.
        name: Label for the dispatch.
    """

    def __init__(
        self,
        horizon_hours: float = 48.0,
        forecaster: Forecaster = persistence_daily,
        name: str = "rolling_horizon",
    ) -> None:
        if horizon_hours <= 0:
            raise ValueError(f"horizon_hours must be positive, got {horizon_hours}")
        self.horizon_hours = horizon_hours
        self.forecaster = forecaster
        self.name = name

    def run(self, prices: pd.Series, battery: BatteryParams) -> Dispatch:
        """Run the receding-horizon loop and return the realised dispatch.

        Args:
            prices: tz-aware price series (EUR/MWh).
            battery: the battery to dispatch.

        Returns:
            The realised :class:`Dispatch` (committed steps only).
        """
        dt = infer_dt_hours(prices.index)  # type: ignore[arg-type]
        n = len(prices)
        horizon_steps = max(1, int(round(self.horizon_hours / dt)))
        forecast = self.forecaster(prices, dt)

        eta_c = battery.eta_charge
        eta_d = battery.eta_discharge

        charge = np.zeros(n)
        discharge = np.zeros(n)
        soc_path = np.zeros(n)

        # Inner solver knows nothing of the true future — only the forecast.
        inner = PerfectForesight(terminal_soc="free")
        soc = battery.soc_init_mwh

        for t in range(n):
            end = min(n, t + horizon_steps)
            window = forecast.iloc[t:end]
            if len(window) < 2:
                # Too short to optimise; idle out the tail.
                soc_path[t] = soc
                continue

            # Re-anchor the battery to the current state of charge for this solve.
            # Clamp the fraction to the validated bounds to absorb float drift.
            soc_frac = min(
                battery.soc_max_frac,
                max(battery.soc_min_frac, soc / battery.energy_mwh),
            )
            window_battery = dataclasses.replace(battery, soc_init_frac=soc_frac)
            plan = inner.run(window, window_battery)

            # Clamp away tiny negative solver noise.
            c = max(0.0, float(plan.charge_mw.iloc[0]))
            d = max(0.0, float(plan.discharge_mw.iloc[0]))
            charge[t] = c
            discharge[t] = d
            # Advance the *true* state of charge by the committed action.
            soc += (eta_c * c - d / eta_d) * dt
            soc_path[t] = soc

        frame = empty_dispatch_frame(prices)
        frame["charge_mw"] = charge
        frame["discharge_mw"] = discharge
        frame["soc_mwh"] = soc_path
        frame[PRICE_COL] = prices.to_numpy(dtype=float)
        return Dispatch(frame=frame, dt_hours=dt, battery=battery, name=self.name)
