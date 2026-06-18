"""pricetaker: an educational battery-storage price-arbitrage simulator.

The package models a battery energy storage system (BESS) that buys and sells
electricity against day-ahead prices. It assumes the battery is a *price
taker* — too small to move the market — so prices are treated as exogenous.

See the README for the economics explainer; this docstring just orients you
in the code:

* ``pricetaker.battery``    — the physical battery model (:class:`BatteryParams`).
* ``pricetaker.data``       — price sources (bundled sample data, live ENTSO-E).
* ``pricetaker.strategies`` — dispatch strategies (LP ceiling + heuristics).
* ``pricetaker.metrics``    — revenue, cycles, and other economics.
* ``pricetaker.plotting``   — plotly figures (no app framework imported).
"""

from pricetaker.battery import BatteryParams

__all__ = ["BatteryParams", "__version__"]

__version__ = "0.1.0"
