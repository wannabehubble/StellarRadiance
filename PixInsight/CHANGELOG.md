# Changelog

All notable changes to StellarRadiance are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.9.2] - 2026-11-12

### Fixed
- Blank preview (and a transparent result) on images with an alpha/transparency channel,
  such as many 16-bit PNG files. The alpha channel is now ignored; only the colour channels
  are processed.

## [2.9.1] - 2026-11-12

First public release.

### Added
- Author credit (Zachary Eichelberger) in the dialog's info box.
- MIT License, README, before/after GIF tool and an interactive comparison page (`docs/`).

### Changed
- Info box redesigned: title, version and author on the first line, a short description of the
  current mode, and a reminder to press **Preview** to start processing.

## [2.9] - 2026-11-11

### Changed
- **Input** options renamed: **Stars-only** (Stellar) or **Starless** (Non-Stellar), and **Combined**
  for images with both stars and background.
- The preview grows with the dialog window. The **Size** menu now sets the minimum preview size.

## [2.8] - 2026-11-11

### Added
- **Image** menu to pick any open image, not just the active one.

### Changed
- **Show advanced settings** is always off when the dialog opens.

## [2.7] - 2026-11-11

### Added
- **Whole image (1/3 res)** preview, now the default view. Pixel-based settings are scaled
  to match, so the glow keeps its size relative to the frame.

## [2.6] - 2026-11-11

### Changed
- The **Refresh** button is now **Preview**.

## [2.5] - 2026-11-11

### Changed
- Modes renamed to **Stellar** and **Non-Stellar**.
- Wider preset menu, so preset names aren't cut off.

### Removed
- Blend mode option. The glow is always screened on.

## [2.4] - 2026-11-11

### Changed
- Renamed from StarGlow to **StellarRadiance**. Saved settings carry over.

## [2.3] - 2026-11-11

### Added
- Non-Stellar presets: **Natural - Light**, **Natural - Moderate** and **Natural - Intense**.

### Changed
- Star removal no longer runs when the dialog opens. It runs when you press Preview or OK.

## [2.2] - 2026-11-11

### Changed
- Stellar presets (Light, Moderate, Intense, Extreme) retuned.

## [2.1] - 2026-11-11

### Added
- **Highlight protection** and **Mask feather**, to keep the glow off bright cores.

## [2.0] - 2026-11-11

### Added
- Second mode for nebulae and galaxies (starless images), with its own settings and presets.

## [1.x]

### Added
- Iterative Gaussian blur glow with live preview and before/after toggle.
- Presets, saved settings and a Reset button.
- Star removal with StarNet2 or StarXTerminator, and recombination.
- Preview that follows PixInsight preview boxes.
- Glow saturation, SCNR, Smooth highlight rolloff, and glow strength up to 30.
