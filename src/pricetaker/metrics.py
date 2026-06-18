"""Economics: turn a :class:`~pricetaker.strategies.base.Dispatch` into numbers.

All revenue figures use the *same* price the dispatch saw, the per-step energy
``power * dt`` (never a hard-coded 1 hour), and the battery's degradation cost.
The sign convention: discharging (selling) earns money, charging (buying) costs
money, so gross revenue is ``sum(price * (discharge - charge) * dt)``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from pricetaker.strategies.base import Dispatch


@dataclass
class Summary:
    """Headline economics for a single dispatch.

    Attributes:
        gross_revenue_eur: Net market cashflow (sell income minus buy cost).
        degradation_cost_eur: Cost charged on discharged throughput.
        net_profit_eur: ``gross_revenue_eur - degradation_cost_eur``.
        energy_charged_mwh: Energy drawn from the grid (AC side).
        energy_discharged_mwh: Energy delivered to the grid (AC side).
        throughput_mwh: Charged plus discharged energy.
        equivalent_full_cycles: Discharged energy divided by usable capacity.
        revenue_per_mwh_capacity: Net profit per MWh of usable capacity.
        revenue_per_cycle: Net profit per equivalent full cycle.
        capacity_factor: Discharged energy as a fraction of the maximum the
            power rating could have delivered over the horizon.
        avg_buy_price: Energy-weighted average price paid when charging.
        avg_sell_price: Energy-weighted average price received when discharging.
        spread_captured: ``avg_sell_price - avg_buy_price``.
    """

    gross_revenue_eur: float
    degradation_cost_eur: float
    net_profit_eur: float
    energy_charged_mwh: float
    energy_discharged_mwh: float
    throughput_mwh: float
    equivalent_full_cycles: float
    revenue_per_mwh_capacity: float
    revenue_per_cycle: float
    capacity_factor: float
    avg_buy_price: float
    avg_sell_price: float
    spread_captured: float

    def as_dict(self) -> dict[str, float]:
        """Return the summary as a plain dict."""
        return asdict(self)


def _safe_div(numerator: float, denominator: float) -> float:
    """Divide, returning NaN instead of raising when the denominator is zero."""
    return numerator / denominator if denominator else float("nan")


def summarise(dispatch: Dispatch) -> Summary:
    """Compute headline economics for a dispatch.

    Args:
        dispatch: the dispatch to summarise (carries its battery and ``dt``).

    Returns:
        A :class:`Summary`.
    """
    dt = dispatch.dt_hours
    battery = dispatch.battery
    price = dispatch.prices.to_numpy(dtype=float)
    charge = dispatch.charge_mw.to_numpy(dtype=float)
    discharge = dispatch.discharge_mw.to_numpy(dtype=float)

    energy_charged = float(np.sum(charge) * dt)
    energy_discharged = float(np.sum(discharge) * dt)
    throughput = energy_charged + energy_discharged

    buy_cost = float(np.sum(price * charge) * dt)
    sell_income = float(np.sum(price * discharge) * dt)
    gross_revenue = sell_income - buy_cost
    degradation_cost = battery.deg_cost_eur_mwh * energy_discharged
    net_profit = gross_revenue - degradation_cost

    equivalent_full_cycles = _safe_div(energy_discharged, battery.usable_energy_mwh)
    revenue_per_mwh_capacity = _safe_div(net_profit, battery.usable_energy_mwh)
    revenue_per_cycle = _safe_div(net_profit, equivalent_full_cycles)

    horizon_hours = len(price) * dt
    max_dischargeable = battery.power_mw * horizon_hours
    capacity_factor = _safe_div(energy_discharged, max_dischargeable)

    avg_buy_price = _safe_div(buy_cost, energy_charged)
    avg_sell_price = _safe_div(sell_income, energy_discharged)
    spread_captured = avg_sell_price - avg_buy_price

    return Summary(
        gross_revenue_eur=gross_revenue,
        degradation_cost_eur=degradation_cost,
        net_profit_eur=net_profit,
        energy_charged_mwh=energy_charged,
        energy_discharged_mwh=energy_discharged,
        throughput_mwh=throughput,
        equivalent_full_cycles=equivalent_full_cycles,
        revenue_per_mwh_capacity=revenue_per_mwh_capacity,
        revenue_per_cycle=revenue_per_cycle,
        capacity_factor=capacity_factor,
        avg_buy_price=avg_buy_price,
        avg_sell_price=avg_sell_price,
        spread_captured=spread_captured,
    )


def compare(named_dispatches: dict[str, Dispatch]) -> pd.DataFrame:
    """Summarise several dispatches side by side.

    Args:
        named_dispatches: mapping from label to dispatch. Labels become the
            DataFrame index.

    Returns:
        A tidy DataFrame, one row per dispatch, one column per metric.
    """
    rows = {name: summarise(d).as_dict() for name, d in named_dispatches.items()}
    return pd.DataFrame.from_dict(rows, orient="index")
