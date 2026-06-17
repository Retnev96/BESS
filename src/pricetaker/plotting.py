"""Plotly figures for a dispatch — pure functions, no app framework imported.

Every function here takes data and returns a :class:`plotly.graph_objects.Figure`
so it can be embedded in Streamlit, a notebook, or saved to HTML. ``plotly`` is
an optional dependency (install with ``pip install -e ".[viz]"``) and is
imported lazily.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pandas as pd

from pricetaker.metrics import compare
from pricetaker.strategies.base import Dispatch

if TYPE_CHECKING:  # pragma: no cover - typing only
    import plotly.graph_objects as go


def price_and_dispatch(dispatch: Dispatch) -> go.Figure:
    """Plot the price curve with charge/discharge power overlaid.

    Charge power is drawn below the axis (energy bought) and discharge above
    (energy sold), on a secondary y-axis, against the price line.

    Args:
        dispatch: the dispatch to plot.

    Returns:
        A plotly figure.
    """
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots

    frame = dispatch.frame
    fig = make_subplots(specs=[[{"secondary_y": True}]])

    fig.add_trace(
        go.Scatter(
            x=frame.index,
            y=dispatch.prices,
            name="Price (EUR/MWh)",
            line={"color": "#1f77b4"},
        ),
        secondary_y=False,
    )
    fig.add_trace(
        go.Bar(
            x=frame.index,
            y=dispatch.discharge_mw,
            name="Discharge (MW)",
            marker_color="#2ca02c",
            opacity=0.6,
        ),
        secondary_y=True,
    )
    fig.add_trace(
        go.Bar(
            x=frame.index,
            y=-dispatch.charge_mw,
            name="Charge (MW)",
            marker_color="#d62728",
            opacity=0.6,
        ),
        secondary_y=True,
    )
    fig.update_layout(
        title=f"Price and dispatch — {dispatch.name}",
        barmode="relative",
        hovermode="x unified",
        legend={"orientation": "h", "y": 1.02, "yanchor": "bottom"},
    )
    fig.update_yaxes(title_text="Price (EUR/MWh)", secondary_y=False)
    fig.update_yaxes(title_text="Power (MW)", secondary_y=True)
    return fig


def state_of_charge(dispatch: Dispatch) -> go.Figure:
    """Plot the state of charge over time.

    Args:
        dispatch: the dispatch to plot.

    Returns:
        A plotly figure.
    """
    import plotly.graph_objects as go

    battery = dispatch.battery
    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=dispatch.frame.index,
            y=dispatch.soc_mwh,
            name="SoC (MWh)",
            fill="tozeroy",
            line={"color": "#9467bd"},
        )
    )
    fig.add_hline(y=battery.soc_max_mwh, line_dash="dot", annotation_text="SoC max")
    fig.add_hline(y=battery.soc_min_mwh, line_dash="dot", annotation_text="SoC min")
    fig.update_layout(
        title=f"State of charge — {dispatch.name}",
        yaxis_title="Energy (MWh)",
        hovermode="x unified",
    )
    return fig


def cumulative_profit(dispatch: Dispatch) -> go.Figure:
    """Plot cumulative net profit over time.

    Args:
        dispatch: the dispatch to plot.

    Returns:
        A plotly figure.
    """
    import plotly.graph_objects as go

    dt = dispatch.dt_hours
    deg = dispatch.battery.deg_cost_eur_mwh
    step_profit = (
        dispatch.prices * (dispatch.discharge_mw - dispatch.charge_mw) * dt
        - deg * dispatch.discharge_mw * dt
    )
    cumulative = step_profit.cumsum()

    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=cumulative.index,
            y=cumulative,
            name="Cumulative profit (EUR)",
            line={"color": "#ff7f0e"},
        )
    )
    fig.update_layout(
        title=f"Cumulative profit — {dispatch.name}",
        yaxis_title="EUR",
        hovermode="x unified",
    )
    return fig


def strategy_comparison(named_dispatches: dict[str, Dispatch]) -> go.Figure:
    """Bar chart comparing net profit and equivalent full cycles across strategies.

    Args:
        named_dispatches: mapping from label to dispatch.

    Returns:
        A plotly figure with two subplots (profit and cycles).
    """
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots

    table = compare(named_dispatches)
    fig = make_subplots(
        rows=1,
        cols=2,
        subplot_titles=("Net profit (EUR)", "Equivalent full cycles"),
    )
    fig.add_trace(
        go.Bar(x=table.index, y=table["net_profit_eur"], marker_color="#1f77b4"),
        row=1,
        col=1,
    )
    fig.add_trace(
        go.Bar(
            x=table.index,
            y=table["equivalent_full_cycles"],
            marker_color="#2ca02c",
        ),
        row=1,
        col=2,
    )
    fig.update_layout(title="Strategy comparison", showlegend=False)
    return fig


def comparison_table(named_dispatches: dict[str, Dispatch]) -> pd.DataFrame:
    """Return the side-by-side metrics table (convenience re-export).

    Args:
        named_dispatches: mapping from label to dispatch.

    Returns:
        The tidy comparison DataFrame from :func:`pricetaker.metrics.compare`.
    """
    return compare(named_dispatches)
