"""Price data sources.

Two ways in:

* :func:`pricetaker.data.sample.load_sample` — bundled offline data so the whole
  project (and CI) runs with no token and no network.
* :func:`pricetaker.data.entsoe.get_day_ahead_prices` — live ENTSO-E fetch with
  an on-disk parquet cache (requires a free API token; kept out of CI).
"""

from pricetaker.data.sample import SAMPLE_ZONES, load_sample

__all__ = ["SAMPLE_ZONES", "load_sample"]
