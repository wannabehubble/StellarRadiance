# StellarRadiance for Siril

A Siril port of the [PixInsight script StellarRadiance](../PixInsight/README.md).

## Requirements

- **Siril 1.4 or later**, with Python scripting.
- The script installs **PyQt6** and **scipy** into Siril's Python environment the first time it runs. This needs an internet connection and takes a minute.
- To use the **Combined** input, you also need one of these:
  - **StarNet2**: the stand-alone `starnet2` command-line tool, StarNet 2.5 or later ([starnetastro.com](https://www.starnetastro.com/)). On older setups, Siril's built-in StarNet (*Preferences → Miscellaneous*) is used if `starnet2` isn't found.
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
| **StarNet2** | Runs the stand-alone `starnet2` command-line tool in a private temporary folder, which is deleted afterwards. The script finds `starnet2` automatically. If it doesn't, click **Locate starnet2...** to point to it. If `starnet2` isn't installed, Siril's older built-in StarNet is used instead, where available. In that case Siril shows the image name with a `starless_` prefix afterwards, even though the script restores your pixels; use **Save As** with your own file name. |
| **StarXTerminator (RC-Astro)** | Runs RC-Astro's `rc-astro` command-line tool in a private temporary folder, which is deleted afterwards. The script finds `rc-astro` automatically. If it doesn't, click **Locate rc-astro...** to point to it. |
| **Starless image file** | Uses a starless version of this image that you made elsewhere. It must be the same size. Click **Choose file...** to pick it. |

## Colour controls (Stellar mode)

Two sliders clean up colour casts in Stellar mode. Both work on colour images only, and 0 turns them off.

| Slider | What it does |
|---|---|
| **SCNR** | Removes a green cast from the stars and their glow (average neutral, lightness preserved). The starless background is not affected. |
| **Inverse SCNR** | Removes a magenta or purple cast from the **glow only**, such as fringing from chromatic aberration or some filters. The glow is inverted, SCNR removes green (which is magenta in the original), and it is inverted back. The stars themselves are not changed. |

You can use both at once: **SCNR** for green stars, **Inverse SCNR** for purple halos.

## Troubleshooting

| Problem | Fix |
|---|---|
| The preview is black or very dark | The image is probably still linear. Stretch it first (see Quick start). |
| The preview only shows the original image | You're using the Combined input. Press **Preview** to run star removal. |
| "StarNet isn't available" or "starnet2 failed" | Install the StarNet2 command-line tool (2.5 or later) from starnetastro.com, or click **Locate starnet2...**. Or choose another star removal option. |
| Purple or magenta halos around stars | Raise **Inverse SCNR** (Stellar mode). |
| A green tint around stars | Raise **SCNR** (Stellar mode). |
| "rc-astro not found" | Install the RC-Astro command-line tool and activate StarXTerminator, or click **Locate rc-astro...**. |
| "The starless image is … but this image is …" | The starless file must be the same size as the loaded image. |
| The window doesn't open | Check Siril's console. On the first run, PyQt6 and scipy need to install, which needs an internet connection. |

## Version history

See [CHANGELOG.md](CHANGELOG.md).

## Contributing

Bug reports and suggestions are welcome. Please open an issue, say that you're using the Siril version, and include your Siril version, the settings you used, Siril's console output and a screenshot if possible.

## License

Released under the [MIT License](../LICENSE). © 2026 Zachary Eichelberger.
