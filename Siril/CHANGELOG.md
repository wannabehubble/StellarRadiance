# Changelog (Siril version)

All notable changes to the Siril version of StellarRadiance are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
For the PixInsight version, see [PixInsight/CHANGELOG.md](../PixInsight/CHANGELOG.md).

## [1.7] - 2026-11-15

### Changed
- **StarNet2** now calls the stand-alone `starnet2` command-line tool (StarNet 2.5 or later)
  directly, in a private temporary folder that is deleted afterwards. This works with newer
  Siril versions, where the built-in `starnet` command was replaced by the StarNet.py script.
  The script finds `starnet2` automatically, or you can point to it with **Locate starnet2...**.
- The loaded image is no longer renamed with a `starless_` prefix when StarNet2 runs.

### Fixed
- If `starnet2` isn't installed, the script falls back to Siril's older built-in `starnet`
  command (Siril 1.4 with older StarNet versions) and shows a clear error if neither is available.

## [1.6] - 2026-11-13

### Added
- **StarXTerminator** as a star removal option for Combined input, through RC-Astro's
  stand-alone command-line tool (`rc-astro`). It runs in a private temporary folder that is
  deleted afterwards. The script finds `rc-astro` automatically, or you can point to it with
  **Locate rc-astro...**.

## [1.5] - 2026-11-13

First release of the Siril version. It matches PixInsight version 2.9.2: same algorithm,
modes, presets and parameters.

### Added
- PyQt6 dialog with live preview (**Whole image (1/3 res)** and **Crop 1:1 (drag to pan)**),
  **Show original** toggle, presets and saved settings for each mode.
- Star removal for Combined input with **StarNet** (run through Siril) or a
  **Starless image file**. StarNet's own output files are written to a temporary folder
  where possible and are always cleaned up afterwards.
- Support for 8-bit images (PNG, JPEG, 8-bit TIFF). The result is written back as 32-bit to
  avoid banding in the glow.
- A warning when the loaded image looks linear (unstretched).
- The whole blur cascade is evaluated as a single Fourier-domain filter per channel. This
  gives exactly the same result as running the passes one by one, and stays fast at the
  large sigmas used by the Extreme preset.
