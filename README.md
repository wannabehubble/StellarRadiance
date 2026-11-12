# StellarRadiance

By **Zachary Eichelberger**

A PixInsight script that adds a natural-looking glow to stars, or to nebulae and galaxies, using iterative Gaussian blur passes.

StellarRadiance imitates light scattering from optics and/or atmosphere by blurring the image in a series of Gaussian blur passes. Each pass is wider than the last and weaker than the last. The passes are added together into a glow layer, which is then screened back onto the image.

<img width="1583" height="1200" alt="5" src="https://github.com/user-attachments/assets/7d26f5f2-93e2-4d7e-84ea-b652c96d7d5c" />

## Features

- Two modes:
  - **Stellar**: glow around stars.
  - **Non-Stellar**: soft bloom on nebulae and galaxies.

  Each mode has its own settings and presets.
- **Built-in star removal.** Run the script on a combined image (stars and background together) and it removes the stars with StarNet2 or StarXTerminator. It then glows the right layer and recombines the two.
- **Live preview** with a before/after toggle. You can view the whole frame at 1/3 resolution, drag a 1:1 crop around the image, or follow a preview box you've drawn in PixInsight.
- **Presets** to get started quickly:
  - Stellar: Light, Moderate, Intense, Extreme.
  - Non-Stellar: Natural - Light, Natural - Moderate, Natural - Intense.
- **Glow controls:**
  - **Highlight protection** stops the glow washing out bright cores.
  - **Smooth highlight rolloff** avoids clipping.
  - **Glow saturation** changes the colour of the glow only.
  - **SCNR** removes green from the stars.
- **Saved settings.** Your last settings are remembered for each mode.
- **Non-destructive.** The result is always written to a new image.

## Requirements

- PixInsight 1.8.9 or later. Older versions will probably work too.
- To use the **Combined** input, you also need one of these:
  - [StarNet2](https://www.starnetastro.com/)
  - [StarXTerminator](https://www.rc-astro.com/software/sxt/) (commercial)

  You don't need either one if you give the script an image whose stars are already separated.

## Installation

1. Download `StellarRadiance.js` and save it somewhere permanent, for example `Documents/PixInsight/scripts/`.
2. In PixInsight, open **Script > Feature Scripts...**
3. Click **Add**, choose the folder that contains `StellarRadiance.js`, then click **Done**.
4. The script now appears under **Script > Utilities > StellarRadiance**.

To try it without installing, open the file in **Script > Script Editor** and press **F9** to run it.

<img width="1583" height="1200" alt="4" src="https://github.com/user-attachments/assets/f724125a-6a49-46fe-b3c3-41a4fcc27400" />

## Quick start

1. Open a **stretched (non-linear)** image and make sure it is the active window.
2. Run **Script > Utilities > StellarRadiance**. The **Image** menu at the top lists every open image; it starts on the active one, and you can switch to any other.
3. Choose a **Glow target**:
   - **Stellar** to add glow around stars.
   - **Non-Stellar** to bloom nebulae and galaxies.
4. Choose an **Input**:
   - **Stars-only** (Stellar) or **Starless** (Non-Stellar), if you've already separated the stars.
   - **Combined**, for an image with both stars and background. The script separates the stars for you; choose the tool under **Star removal**.
5. Choose a **Preset** and press **Preview** to start processing. Then adjust the settings while you watch the preview.
6. Click **OK**. The result opens as a new image:
   - `<name>_glow` in Stellar mode.
   - `<name>_objglow` in Non-Stellar mode.

> **Combined input:** star removal can be slow, so it never runs on its own when the dialog opens. The preview shows your original image until you press **Preview**. Preview runs star removal once, and after that the preview updates live. If you skip Preview, star removal runs when you click OK.

## How it works

1. **Select the source.**
   - In **Stellar** mode, only stars brighter than the *Threshold* produce glow. The *Star size filter* can also leave out small stars.
   - In **Non-Stellar** mode, only brightness above the *Threshold* produces glow, so the faint background stays dark.
2. **Blur in passes.** The source is blurred again on each pass:
   - The first pass uses *First pass sigma*.
   - Each later pass multiplies the sigma by the *Sigma growth factor*.
   - Each pass is added to the glow layer with weight `decay^k`, normalised and scaled by *Glow strength*.
3. **Roll off the highlights.** The glow layer is compressed as it nears white (*Highlight rolloff*).
4. **Adjust colour.** *Glow saturation* is applied to the glow layer.
5. **Protect highlights.** A feathered lightness mask holds the glow back where the image is already bright (*Highlight protection*, *Mask feather*).
6. **Screen the glow on.** The glow is combined with the layer using `1 - (1 - image) * (1 - glow)`.
7. **Recombine** (Combined input only). The stars are separated by computing the stars layer as `1 - (1 - original) / (1 - starless)`. Recombining by screening reproduces the original exactly, apart from the added glow.
   - In **Stellar** mode, the glowed stars are screened onto the starless image.
   - In **Non-Stellar** mode, the stars are screened, unchanged, onto the glowed starless image.

<img width="1583" height="1200" alt="6" src="https://github.com/user-attachments/assets/2a31a2bc-d7e5-47d2-b715-3c5f70978f1a" />

## Parameters

Parameters marked *(advanced)* only appear when **Show advanced settings** is ticked. The box is unticked each time the dialog opens, to keep it uncluttered. Hidden settings are still used.

| Parameter | Range | Description |
|---|---|---|
| Blur passes | 1–12 | Number of blur passes. More passes give a wider, smoother falloff. |
| First pass sigma *(advanced)* | 0.5–20 px | Width of the first, tightest pass. Larger values suit large-scale objects. |
| Sigma growth factor *(advanced)* | 1.1–3.0 | How much wider each pass is than the one before. |
| Weight decay *(advanced)* | 0.3–1.0 | How quickly the outer halos fade. Lower gives a tighter glow; 1.0 weights all passes equally. |
| Glow strength | 0.05–30 | Overall intensity of the glow. Above about 3 is very bloomy; 10–30 is extreme. |
| Threshold *(advanced)* | 0–0.98 | **Stellar:** only stars brighter than this glow. **Non-Stellar:** only brightness above this level blooms. |
| Star size filter *(advanced, Stellar only)* | 0–10 px | Leaves out small stars. 0 = off. |
| Glow saturation | 0–3 | Colour of the glow only. 0 = white, 1 = natural, above 1 = more colourful. Colour images only. |
| Highlight protection | 0–1 | Holds the glow back from areas that are already bright. 0 = off; 1 = no glow on pure white. |
| Mask feather | 0–50 px | Softens the edges of the highlight-protection mask. |
| SCNR amount *(Stellar only)* | 0–1 | Removes green from the stars and their glow. 0 = off. Colour images only. |
| Highlight rolloff | None / Exponential / Smooth | How the glow is compressed near white. **Smooth** gives the most natural falloff at high strengths. |
| Keep glow layer as a separate image | on/off | Also opens the glow layer by itself as a separate image, so you can blend it manually. |

## Presets

Presets only change the parameters they list. Once you edit any of those parameters, the menu shows **Custom**.

**Stellar** presets set all of the following:

- *Threshold* 0.375
- *Star size filter* 7
- *Glow saturation* 1.0
- *Highlight rolloff* Smooth

They leave your SCNR, Highlight protection and Mask feather settings alone.

| Preset | Passes | First sigma | Growth | Decay | Strength |
|---|---|---|---|---|---|
| Light | 6 | 12.0 | 3.0 | 1.0 | 2 |
| Moderate | 6 | 12.0 | 3.0 | 1.0 | 8 |
| Intense | 6 | 12.0 | 3.0 | 1.0 | 16 |
| Extreme | 12 | 6.0 | 1.5 | 1.0 | 30 |

**Non-Stellar** presets all share these settings:

- 6 passes
- *First pass sigma* 15.0
- *Sigma growth factor* 3.0
- *Weight decay* 0.75
- *Threshold* 0.065
- *Glow saturation* 1.0
- *Highlight protection* 0.50
- *Mask feather* 25
- *Highlight rolloff* Smooth

They differ only in strength:

| Preset | Strength |
|---|---|
| Natural - Light | 0.30 |
| Natural - Moderate | 0.60 |
| Natural - Intense | 0.90 |

## Preview controls

- **Live update:** re-renders the preview automatically, shortly after a setting changes.
- **Show original:** shows the image before the glow, for comparison.
- **Region:**
  - **Whole image (1/3 res)** is the default. The full frame is reduced to one third of its resolution, processed, and fitted to the preview box. Pixel-based settings (sigmas, star size filter, mask feather) are scaled to match, so the glow keeps the same size relative to the frame. It's an approximation: small stars are averaged together at this scale, so use the crop to judge fine detail.
  - **Crop 1:1** gives a full-resolution crop you can drag to pan around the image.
  - Choosing a PixInsight preview box shows exactly that area. Areas larger than the preview are scaled to fit.
- **Size:** the minimum preview size (400, 600 or 800 px). Drag the dialog window larger and the preview grows with it.
- **Center:** moves the 1:1 crop back to the centre of the image.
- **Preview:** re-renders the preview. With Combined input, it also runs star removal the first time.

The preview runs the same algorithm as the final result. In the crop and preview-box views, the crop is processed with extra margin around it, so the glow near its edges matches the full image.

## Buttons

- **Reset:** puts the current mode's settings back to their defaults (Natural - Light in Non-Stellar mode).
- **OK:** saves your settings and creates the result.
- **Cancel:** closes the dialog without changing anything.

## Tips

- Work on a **stretched** image. The thresholds and strengths are tuned for non-linear data.
- Start from a preset, then adjust **Glow strength** first.
- If bright star cores or galaxy cores look washed out, raise **Highlight protection**. Raise **Mask feather** if the edge of the protected area becomes visible.
- If the glow clips into flat white discs, use **Smooth** rolloff or lower the strength.
- To blend the glow yourself (in PixelMath, or with a mask), tick **Keep glow layer as a separate image**.

## Troubleshooting

| Problem | Fix |
|---|---|
| "StarNet2 / StarXTerminator is not installed" | Install the tool, or separate the stars yourself and choose the stars-only or starless input. |
| The preview only shows the original image | You're using the Combined input. Press **Preview** to run star removal. |
| The glow looks grey on a colour image | Raise **Glow saturation** above 1.0. |
| A green tint around stars | Raise **SCNR amount** (Stellar mode). |
| Settings don't match a preset | Saved settings take priority. Choose the preset from the menu, or press **Reset**. |

## Version history

See [CHANGELOG.md](CHANGELOG.md).

## Contributing

Bug reports and suggestions are welcome. Please open an issue and include your PixInsight version, the settings you used, and a screenshot if possible.

## License

Released under the [MIT License](LICENSE). © 2026 Zachary Eichelberger.
