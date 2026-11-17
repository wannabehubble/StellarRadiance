# StellarRadiance

By **Zachary Eichelberger**

Adds a natural-looking glow to stars, or to nebulae and galaxies, using iterative Gaussian blur passes.

StellarRadiance imitates light scattering from optics and/or atmosphere by blurring the image in a series of Gaussian blur passes. Each pass is wider than the last and weaker than the last. The passes are added together into a glow layer, which is then screened back onto the image.

<img width="1583" height="1200" alt="5" src="https://github.com/user-attachments/assets/7d26f5f2-93e2-4d7e-84ea-b652c96d7d5c" />

## Which version do I need?

StellarRadiance is available for two astrophotography programs. Both use the same algorithm, modes and presets.

| You use | Download | Version | Instructions |
|---|---|---|---|
| **PixInsight** | [`PixInsight/StellarRadiance.js`](PixInsight/StellarRadiance.js) | 2.10 | [PixInsight README](PixInsight/README.md) |
| **Siril** | [`Siril/StellarRadiance.py`](Siril/StellarRadiance.py) | 1.8.1 | [Siril README](Siril/README.md) |

Each version has its own changelog: [PixInsight](PixInsight/CHANGELOG.md), [Siril](Siril/CHANGELOG.md).

## Features

- Two modes:
  - **Stellar**: glow on stars.
  - **Non-Stellar**: glow on nebulae and galaxies.

  Each mode has its own settings and presets.
- **Built-in star removal.** Run it on a combined image (stars and background together) and it removes the stars from the background once more, then glow is applied to the stars and it recombines the two.
- **Live preview** with a before/after toggle.
- **Presets** to get started quickly:
  - Stellar: Light, Moderate, Intense, Extreme.
  - Non-Stellar: Natural - Light, Natural - Moderate, Natural - Intense.
- **Extra controls:** highlight protection, smooth highlight rolloff, glow saturation, SCNR/Inverse SCNR, which removes magenta fringing from the glow.

Both versions work on **stretched (non-linear)** images.

## Contributing

Bug reports and suggestions are welcome. Please open an issue and say which version you use (PixInsight or Siril, and its version number), the settings you used, and include a screenshot if possible.

## License

Released under the [MIT License](LICENSE). © 2026 Zachary Eichelberger.
