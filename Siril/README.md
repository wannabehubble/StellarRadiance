# StellarRadiance for Siril

A Siril port of the [PixInsight script StellarRadiance](../PixInsight/README.md). It adds a natural-looking glow to stars, or a soft bloom to nebulae and galaxies, using iterative Gaussian blur passes. The algorithm, modes and presets match the PixInsight version (2.9.2).

## Requirements

- **Siril 1.4 or later**, with Python scripting.
- The script installs **PyQt6** and **scipy** into Siril's Python environment the first time it runs. This needs an internet connection and takes a minute.
- To use the **Combined** input, you also need one of these:
  - **StarNet**, set up in Siril (*Preferences → Miscellaneous*: the path to the StarNet command-line tool).
  - **StarXTerminator**, through RC-Astro's stand-alone command-line tool `rc-astro` ([rc-astro.com](https://www.rc-astro.com/)), with an activated StarXTerminator license.
  - A starless version of your image that you made elsewhere, saved as a file.

  You don't need any of these if you give the script an image whose stars are already separated.

## Installation

1. Download `StellarRadiance.py`.
2. Put it in a Siril scripts folder. The folders Siril reads are listed under *Preferences → Scripts*. You can add your own folder there.
3. Refresh the scripts list (or restart Siril). The script appears in the **Scripts** menu.

## Quick start

1. Load a **stretched (non-linear)** image in Siril.

   Siril's *AutoStretch* display mode only changes how the image looks, not the pixels. If the display mode at the bottom of the window isn't **Linear**, switch it to Linear to check. If the image goes dark, stretch it for real first (Histogram, Asinh or GHS). The script warns you when an image looks unstretched.
2. Run **Scripts → StellarRadiance**.
3. Choose a **Glow target**:
   - **Stellar** to add glow around stars.
   - **Non-Stellar** to bloom nebulae and galaxies.
4. Choose an **Input**:
   - **Stars-only** (Stellar) or **Starless** (Non-Stellar), if you've already separated the stars.
   - **Combined**, for an image with both stars and background. Choose the tool under **Star removal**.
5. Choose a **Preset** and press **Preview**, then adjust the settings while you watch the preview.
6. Click **Apply**. The result replaces the loaded image. Use Siril's **Undo** to go back.

## Star removal (Combined input)

Star removal can be slow, so it never runs on its own. The preview shows your original image until you press **Preview**. Preview runs star removal once, and after that the preview updates live. If you skip Preview, star removal runs when you click Apply.

| Option | How it works |
|---|---|
| **StarNet (run in Siril)** | Runs Siril's built-in StarNet integration. StarNet's own files are written to a temporary folder (or, if that isn't possible, deleted afterwards), so nothing is left in your working folder. Afterwards Siril shows the image name with a `starless_` prefix, even though the script restores your pixels. Use **Save As** with your own file name. |
| **StarXTerminator (RC-Astro)** | Runs RC-Astro's `rc-astro` command-line tool in a private temporary folder, which is deleted afterwards. The script finds `rc-astro` automatically. If it doesn't, click **Locate rc-astro...** to point to it. |
| **Starless image file** | Uses a starless version of this image that you made elsewhere. It must be the same size. Click **Choose file...** to pick it. |

## Differences from the PixInsight version

- **Apply** changes the loaded image instead of opening a new window. Siril's Undo reverses it.
- **Also save the glow layer as a FITS file** saves the glow as `<name>_glowlayer.fit` next to your image, instead of opening it as a separate window.
- There is no **Image** menu. Siril works on one loaded image at a time.
- There are no PixInsight-style preview boxes. The **Region** menu offers **Whole image (1/3 res)** and **Crop 1:1 (drag to pan)**.
- There is no preview **Size** menu. Resize the window and the preview grows with it.
- Star removal can also use **StarNet** through Siril, **StarXTerminator** through RC-Astro's command-line tool, or a starless image file.
- 8-bit images (PNG, JPEG, 8-bit TIFF) are supported. The result is written back as 32-bit to avoid banding in the glow.
- All the blur passes are combined into a single filter for each colour channel. This gives exactly the same result as running the passes one by one, and it's fast even at the large sizes the Extreme preset uses.

## Parameters and presets

The parameters and their ranges are the same as in the PixInsight version: see its [Parameters](../PixInsight/README.md#parameters) section. The presets are the same too:

- **Stellar:** Light, Moderate, Intense, Extreme.
- **Non-Stellar:** Natural - Light, Natural - Moderate, Natural - Intense.

Settings are saved for each mode when you click Apply, in `StellarRadiance.json` in Siril's configuration folder.

## Troubleshooting

| Problem | Fix |
|---|---|
| The preview is black or very dark | The image is probably still linear. Stretch it first (see Quick start). |
| The preview only shows the original image | You're using the Combined input. Press **Preview** to run star removal. |
| "StarNet failed" | Check the StarNet path in Siril's *Preferences → Miscellaneous*, or choose another star removal option. |
| "rc-astro not found" | Install the RC-Astro command-line tool and activate StarXTerminator, or click **Locate rc-astro...**. |
| "The starless image is … but this image is …" | The starless file must be the same size as the loaded image. |
| The window doesn't open | Check Siril's console. On the first run, PyQt6 and scipy need to install, which needs an internet connection. |

## Version history

See [CHANGELOG.md](CHANGELOG.md).

## Contributing

Bug reports and suggestions are welcome. Please open an issue, say that you're using the Siril version, and include your Siril version, the settings you used, Siril's console output and a screenshot if possible.

## License

Released under the [MIT License](../LICENSE). © 2026 Zachary Eichelberger.
