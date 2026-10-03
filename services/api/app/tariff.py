"""Electricity tariffs.

One demo time-of-use tariff for every site until tariffs are configurable per site.
The bands mirror the simulator scenario (apps/web/src/sim/scenario.ts) so live
costs and the game use the same prices.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Tariff:
    name: str
    currency: str
    # (start hour in local time, import price per kWh), ascending from hour 0.
    import_bands: tuple[tuple[float, float], ...]
    export_price: float

    def import_price(self, local_hour: float) -> float:
        price = self.import_bands[0][1]
        for start, band_price in self.import_bands:
            if local_hour >= start:
                price = band_price
        return price


DEFAULT_TARIFF = Tariff(
    name="Time-of-use (demo)",
    currency="EUR",
    import_bands=((0, 0.11), (7, 0.19), (11, 0.13), (15, 0.21), (17, 0.32), (21, 0.14)),
    export_price=0.06,
)
