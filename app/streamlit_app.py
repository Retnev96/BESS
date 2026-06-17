"""Interactive Streamlit demo for the pricetaker BESS arbitrage simulator.

Run with::

    streamlit run app/streamlit_app.py

The app works fully offline using the bundled sample data — no ENTSO-E token
required. Toggle "live data" in the sidebar to fetch real prices (needs a token
and network access).
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

from pricetaker.battery import BatteryParams
from pricetaker.data.sample import SAMPLE_ZONES, load_sample
from pricetaker.plotting import (
    comparison_table,
    cumulative_profit,
    price_and_dispatch,
    state_of_charge,
    strategy_comparison,
)
from pricetaker.strategies import DailyTopN, PerfectForesight, RollingHorizon, Threshold

st.set_page_config(page_title="pricetaker — BESS arbitrage", layout="wide")

# Strategy registry: label -> factory. Kept here so the app is self-contained.
STRATEGIES = {
    "perfect_foresight": PerfectForesight,
    "threshold": Threshold,
    "daily_topn": DailyTopN,
    "rolling_horizon": RollingHorizon,
}


@st.cache_data(show_spinner=False)
def _load_sample_cached(zone: str) -> pd.Series:
    """Cache the (cheap) sample loader so re-runs are instant."""
    return load_sample(zone)


@st.cache_data(show_spinner=True)
def _fetch_live_cached(zone: str, start: str, end: str) -> pd.Series:
    """Cache live ENTSO-E fetches to avoid burning API rate limits."""
    from pricetaker.data.entsoe import get_day_ahead_prices

    return get_day_ahead_prices(zone, start, end)


def _sidebar() -> dict:
    """Render the sidebar and return the chosen settings."""
    st.sidebar.header("Data")
    use_sample = st.sidebar.toggle("Use sample data (no token needed)", value=True)
    zone = st.sidebar.selectbox(
        "Bidding zone", SAMPLE_ZONES if use_sample else ["AT", "DE_LU", "NL", "FR"]
    )

    start = end = None
    if not use_sample:
        start = st.sidebar.date_input("Start").isoformat()
        end = st.sidebar.date_input("End").isoformat()

    st.sidebar.header("Battery")
    power = st.sidebar.number_input("Power (MW)", min_value=0.1, value=10.0, step=1.0)
    energy = st.sidebar.number_input("Energy (MWh)", min_value=0.1, value=20.0, step=1.0)
    eta_rt = st.sidebar.slider("Round-trip efficiency", 0.5, 1.0, 0.86, 0.01)
    soc_min = st.sidebar.slider("SoC min (fraction)", 0.0, 0.9, 0.0, 0.05)
    soc_max = st.sidebar.slider("SoC max (fraction)", 0.1, 1.0, 1.0, 0.05)
    deg_cost = st.sidebar.number_input(
        "Degradation cost (EUR/MWh)", min_value=0.0, value=0.0, step=1.0
    )

    st.sidebar.header("Strategies")
    chosen = [
        name for name in STRATEGIES if st.sidebar.checkbox(name, value=name != "rolling_horizon")
    ]

    return {
        "use_sample": use_sample,
        "zone": zone,
        "start": start,
        "end": end,
        "power": power,
        "energy": energy,
        "eta_rt": eta_rt,
        "soc_min": soc_min,
        "soc_max": soc_max,
        "deg_cost": deg_cost,
        "chosen": chosen,
    }


def main() -> None:
    """Render the app."""
    st.title("🔋 pricetaker — battery price-arbitrage simulator")
    st.caption(
        "Educational simulator. Not a trading bot and not financial advice. "
        "The battery is modelled as a price taker (it does not move the market)."
    )

    cfg = _sidebar()

    if cfg["soc_min"] >= cfg["soc_max"]:
        st.error("SoC min must be below SoC max.")
        return
    if not cfg["chosen"]:
        st.info("Pick at least one strategy in the sidebar.")
        return

    try:
        if cfg["use_sample"]:
            prices = _load_sample_cached(cfg["zone"])
            st.info(f"Using **synthetic** sample data for {cfg['zone']} — not real prices.")
        else:
            if not (cfg["start"] and cfg["end"]):
                st.warning("Choose a start and end date.")
                return
            prices = _fetch_live_cached(cfg["zone"], cfg["start"], cfg["end"])
    except RuntimeError as exc:
        st.error(f"Could not load live data: {exc}")
        st.stop()
        return
    except Exception as exc:  # noqa: BLE001 - surface any data error friendlily
        st.error(f"No data for that selection: {exc}")
        return

    battery = BatteryParams(
        power_mw=cfg["power"],
        energy_mwh=cfg["energy"],
        eta_rt=cfg["eta_rt"],
        soc_min_frac=cfg["soc_min"],
        soc_max_frac=cfg["soc_max"],
        soc_init_frac=cfg["soc_min"] + (cfg["soc_max"] - cfg["soc_min"]) / 2,
        deg_cost_eur_mwh=cfg["deg_cost"],
    )

    dispatches = {name: STRATEGIES[name]().run(prices, battery) for name in cfg["chosen"]}

    st.subheader("Strategy comparison")
    st.plotly_chart(strategy_comparison(dispatches), use_container_width=True)
    st.dataframe(comparison_table(dispatches).style.format("{:,.2f}"))

    st.subheader("Dispatch detail")
    focus = st.selectbox("Strategy to inspect", list(dispatches))
    chosen_dispatch = dispatches[focus]
    st.plotly_chart(price_and_dispatch(chosen_dispatch), use_container_width=True)
    col1, col2 = st.columns(2)
    with col1:
        st.plotly_chart(state_of_charge(chosen_dispatch), use_container_width=True)
    with col2:
        st.plotly_chart(cumulative_profit(chosen_dispatch), use_container_width=True)


if __name__ == "__main__":
    main()
