"""Perfect-foresight dispatch via linear programming — the theoretical ceiling.

This strategy knows *all* future prices and solves a single linear program for
the profit-maximising charge/discharge schedule. No real strategy can beat it,
so it is the yardstick every heuristic is measured against.

The solver lives behind a thin function so it can be swapped. We default to
PuLP (which ships the CBC solver and reads clearly). Alternatives worth knowing:

* ``scipy.optimize.linprog(method="highs")`` — fast, no extra solver install.
* ``linopy`` — pandas-native modelling, nice for large problems.

We deliberately do *not* pull in ``cvxpy`` in v1.
"""

from __future__ import annotations

import pandas as pd
import pulp

from pricetaker.battery import BatteryParams
from pricetaker.strategies.base import (
    PRICE_COL,
    Dispatch,
    empty_dispatch_frame,
    infer_dt_hours,
)


class PerfectForesight:
    """Profit-maximising LP dispatch with full knowledge of future prices.

    The decision variables for each step ``t`` (with step length ``dt`` hours):

    * ``c_t``  charge power, ``0 <= c_t <= P_max``
    * ``d_t``  discharge power, ``0 <= d_t <= P_max``
    * ``s_t``  state of charge, ``SoC_min <= s_t <= SoC_max``

    State dynamics (``s_0`` fixed from ``soc_init_frac``)::

        s_t = s_{t-1} + (eta_c * c_t - d_t / eta_d) * dt

    Objective (maximise EUR profit)::

        max  sum_t price_t * (d_t - c_t) * dt  -  deg_cost * sum_t (d_t * dt)

    No binary "not both at once" constraint is needed: with the round-trip
    efficiency penalty and (mostly) positive prices it is never optimal to
    charge and discharge in the same step, so the LP stays an LP and solves
    fast. The tests assert this holds on the sample data.

    Negative prices are a *feature*. When ``price_t < 0`` the battery may be
    paid to consume energy, so the LP will happily charge — exactly the
    behaviour we want to teach.

    Args:
        terminal_soc: Terminal state-of-charge handling.

            * ``"free"`` (default): the battery may end at any SoC. Simple and
              honest for single-day runs.
            * ``"min_start"``: force the final SoC to be at least the initial
              SoC, so multi-day runs are not gamed by draining the battery dry
              at the very end.
        name: Label used in plots and tables.
    """

    def __init__(self, terminal_soc: str = "free", name: str = "perfect_foresight") -> None:
        if terminal_soc not in ("free", "min_start"):
            raise ValueError(f"terminal_soc must be 'free' or 'min_start', got {terminal_soc!r}")
        self.terminal_soc = terminal_soc
        self.name = name

    def run(self, prices: pd.Series, battery: BatteryParams) -> Dispatch:
        """Solve the LP and return the optimal dispatch.

        Args:
            prices: tz-aware price series (EUR/MWh).
            battery: the battery to dispatch.

        Returns:
            The optimal :class:`Dispatch`.

        Raises:
            RuntimeError: If the solver does not reach an optimal solution.
        """
        dt = infer_dt_hours(prices.index)  # type: ignore[arg-type]
        price = prices.to_numpy(dtype=float)
        n = len(price)

        eta_c = battery.eta_charge
        eta_d = battery.eta_discharge
        p_max = battery.power_mw
        soc_lo = battery.soc_min_mwh
        soc_hi = battery.soc_max_mwh
        soc0 = battery.soc_init_mwh
        deg = battery.deg_cost_eur_mwh

        problem = pulp.LpProblem("bess_arbitrage", pulp.LpMaximize)

        charge = [pulp.LpVariable(f"c_{t}", lowBound=0, upBound=p_max) for t in range(n)]
        discharge = [pulp.LpVariable(f"d_{t}", lowBound=0, upBound=p_max) for t in range(n)]
        soc = [pulp.LpVariable(f"s_{t}", lowBound=soc_lo, upBound=soc_hi) for t in range(n)]

        # Objective: revenue from net export minus throughput degradation cost.
        problem += pulp.lpSum(
            price[t] * (discharge[t] - charge[t]) * dt - deg * discharge[t] * dt for t in range(n)
        )

        # State-of-charge dynamics.
        for t in range(n):
            prev = soc0 if t == 0 else soc[t - 1]
            problem += (
                soc[t] == prev + (eta_c * charge[t] - discharge[t] / eta_d) * dt,
                f"soc_balance_{t}",
            )

        # Optional terminal condition.
        if self.terminal_soc == "min_start" and n > 0:
            problem += (soc[n - 1] >= soc0, "terminal_soc_min_start")

        status = problem.solve(pulp.PULP_CBC_CMD(msg=False))
        if pulp.LpStatus[status] != "Optimal":
            raise RuntimeError(f"LP did not solve to optimality (status: {pulp.LpStatus[status]})")

        frame = empty_dispatch_frame(prices)
        # Clamp away tiny negative solver noise on the non-negative variables.
        frame["charge_mw"] = [max(0.0, charge[t].value() or 0.0) for t in range(n)]
        frame["discharge_mw"] = [max(0.0, discharge[t].value() or 0.0) for t in range(n)]
        frame["soc_mwh"] = [soc[t].value() or 0.0 for t in range(n)]
        frame[PRICE_COL] = price

        return Dispatch(frame=frame, dt_hours=dt, battery=battery, name=self.name)
