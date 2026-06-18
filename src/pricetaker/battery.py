"""The physical battery model.

The battery is described by :class:`BatteryParams`. It is deliberately
*price-agnostic*: it knows about power, energy, efficiency and state-of-charge
limits, but nothing about electricity prices. Strategies (in
:mod:`pricetaker.strategies`) consume a :class:`BatteryParams` together with a
price series to decide when to charge and discharge.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class BatteryParams:
    """Parameters describing a battery energy storage system.

    Round-trip efficiency is split symmetrically across the two conversion
    steps: charging and discharging each incur ``sqrt(eta_rt)`` so that a full
    charge-then-discharge cycle returns ``eta_rt`` of the energy. This is the
    standard convention and keeps the two directions on an equal footing.

    Attributes:
        power_mw: Maximum charge/discharge power in MW (symmetric in v1).
        energy_mwh: Usable energy capacity in MWh (the span between the SoC
            limits is ``energy_mwh * (soc_max_frac - soc_min_frac)``).
        eta_rt: Round-trip efficiency in (0, 1]. Default 0.86 is typical for a
            modern lithium-ion grid battery.
        soc_min_frac: Lower state-of-charge bound as a fraction of ``energy_mwh``.
        soc_max_frac: Upper state-of-charge bound as a fraction of ``energy_mwh``.
        soc_init_frac: Initial state of charge as a fraction of ``energy_mwh``.
        deg_cost_eur_mwh: Degradation cost charged per MWh of energy discharged
            (a simple proxy for cycle ageing). Default 0.
    """

    power_mw: float
    energy_mwh: float
    eta_rt: float = 0.86
    soc_min_frac: float = 0.0
    soc_max_frac: float = 1.0
    soc_init_frac: float = 0.5
    deg_cost_eur_mwh: float = 0.0

    def __post_init__(self) -> None:
        """Validate the parameters, raising ``ValueError`` on nonsense input."""
        if self.power_mw <= 0:
            raise ValueError(f"power_mw must be positive, got {self.power_mw}")
        if self.energy_mwh <= 0:
            raise ValueError(f"energy_mwh must be positive, got {self.energy_mwh}")
        if not 0 < self.eta_rt <= 1:
            raise ValueError(f"eta_rt must be in (0, 1], got {self.eta_rt}")
        if self.deg_cost_eur_mwh < 0:
            raise ValueError(f"deg_cost_eur_mwh must be non-negative, got {self.deg_cost_eur_mwh}")
        for name, value in (
            ("soc_min_frac", self.soc_min_frac),
            ("soc_max_frac", self.soc_max_frac),
            ("soc_init_frac", self.soc_init_frac),
        ):
            if not 0 <= value <= 1:
                raise ValueError(f"{name} must be in [0, 1], got {value}")
        if self.soc_min_frac >= self.soc_max_frac:
            raise ValueError(
                "soc_min_frac must be strictly below soc_max_frac, got "
                f"{self.soc_min_frac} >= {self.soc_max_frac}"
            )
        if not self.soc_min_frac <= self.soc_init_frac <= self.soc_max_frac:
            raise ValueError(
                "soc_init_frac must lie within [soc_min_frac, soc_max_frac], got "
                f"{self.soc_init_frac} outside "
                f"[{self.soc_min_frac}, {self.soc_max_frac}]"
            )

    @property
    def eta_charge(self) -> float:
        """One-way charging efficiency, ``sqrt(eta_rt)``."""
        return math.sqrt(self.eta_rt)

    @property
    def eta_discharge(self) -> float:
        """One-way discharging efficiency, ``sqrt(eta_rt)``."""
        return math.sqrt(self.eta_rt)

    @property
    def soc_min_mwh(self) -> float:
        """Lower state-of-charge bound in MWh."""
        return self.soc_min_frac * self.energy_mwh

    @property
    def soc_max_mwh(self) -> float:
        """Upper state-of-charge bound in MWh."""
        return self.soc_max_frac * self.energy_mwh

    @property
    def soc_init_mwh(self) -> float:
        """Initial state of charge in MWh."""
        return self.soc_init_frac * self.energy_mwh

    @property
    def usable_energy_mwh(self) -> float:
        """Usable energy span between the SoC limits, in MWh."""
        return self.soc_max_mwh - self.soc_min_mwh
