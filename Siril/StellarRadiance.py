# ============================================================================
# StellarRadiance.py  -  Siril (sirilpy) script
#
# Siril port of the PixInsight script StellarRadiance v2.9 (formerly StarGlow)
# by Zachary Eichelberger.
#
# Adds a natural-looking glow to stars, or a soft bloom to nebulae and
# galaxies, using iterative (cascaded) Gaussian blur passes. Each pass blurs
# the previous result a little more, and every pass is added to a glow layer
# with a decaying weight. Tight inner halos come out strong and wide outer
# halos come out faint, which is roughly how light scatters in optics and
# atmosphere. The glow is then screened back onto the image.
#
# Modes (Glow target):
#   Stellar      glow around stars. Input: a stars-only image, or a combined
#                image (stars are separated first, glowed, then recombined).
#   Non-Stellar  soft bloom on nebulae / galaxies. Input: a starless image,
#                or a combined image (stars are screened back on, unglowed).
#
# Combined input needs a starless version of the image, from one of:
#   - StarNet, run through Siril (StarNet CLI must be set up in Siril's
#     Preferences),
#   - StarXTerminator, through RC-Astro's stand-alone command-line tool
#     (rc-astro, from rc-astro.com, with an activated StarXTerminator
#     license), or
#   - a starless image file you made elsewhere.
# The stars-only layer is computed by "unscreening":
#     stars = 1 - (1 - original) / (1 - starless)
# so that screening the stars back onto the starless image reproduces the
# original exactly before any glow is added.
#
# Use on a NON-LINEAR (stretched) image. The result replaces the loaded image
# in Siril and can be undone with Siril's Undo.
#
# StarNet's own output files (starless_*.fit/.tif) are written to a temporary
# folder when possible and are always cleaned up afterwards.
#
# Requires Siril 1.4 or later. PyQt6 and scipy are installed automatically
# into Siril's Python environment on first run.
#
# Siril edition history
# 1.6   StarXTerminator (RC-Astro CLI) added as a star removal tool.
# 1.5   Siril release; matches PixInsight v2.9.2 (same algorithm, presets
#       and settings). The whole glow cascade is evaluated in the Fourier
#       domain (one forward + one inverse FFT per channel), which is exactly
#       equivalent to the iterative blurs and much faster for large sigmas.
# ============================================================================

import sys
import os
import json
import math
import time
import shutil
import subprocess
import threading
import glob
import tempfile

import numpy as np

try:
    import sirilpy as s
    s.ensure_installed("PyQt6", "scipy")
except ImportError:          # allows the core maths to be imported for testing
    s = None

from scipy import ndimage
from scipy import fft as sfft
from PyQt6 import QtCore, QtGui, QtWidgets

TITLE = "StellarRadiance"
VERSION = "1.6"
AUTHOR = "Zachary Eichelberger"
EDITION = "Siril"

# ----------------------------------------------------------------------------
# Parameter sets. Each glow target (mode) has its own defaults, presets and
# saved settings.
#
#   passes     number of blur passes
#   baseSigma  sigma (px) of the first pass
#   growth     each pass's sigma = previous sigma * growth
#   decay      weight of pass k = decay^k (normalized)
#   strength   overall glow intensity
#   threshold  Stellar: hard brightness cutoff for which stars glow
#              Non-Stellar: only brightness ABOVE this level blooms
#   starSize   small-star rejection (px), Stellar mode only; 0 = off
#   rolloff    0 = none (hard clip), 1 = exponential, 2 = smooth
#   glowSat    glow saturation: 0 = white glow, 1 = natural, >1 = more colour
#   scnrAmount SCNR green removal on stars + glow, Stellar mode only; 0 = off
#   hlProtect  highlight protection: 0 = off .. 1 = no glow on pure white
#   hlFeather  blur (px) applied to the highlight-protection mask
#   keepGlow   also save the glow layer as its own FITS file
# ----------------------------------------------------------------------------
MODE_STARS = 0
MODE_OBJECT = 1
MODE_NAMES = ["Stellar", "Non-Stellar"]

MODES = [
    {   # ---------------- Stellar ----------------
        "key": "stellar",
        "defaults": dict(passes=6, baseSigma=1.5, growth=1.6, decay=0.70, strength=0.60,
                         threshold=0.05, starSize=0.0, rolloff=2,
                         glowSat=1.0, scnrAmount=0.0, hlProtect=0.0, hlFeather=5.0,
                         keepGlow=False),
        "presets": [
            ("Light",    dict(passes=6, baseSigma=12.0, growth=3.0, decay=1.0, strength=2.0,
                              threshold=0.375, starSize=7.0, glowSat=1.0, rolloff=2)),
            ("Moderate", dict(passes=6, baseSigma=12.0, growth=3.0, decay=1.0, strength=8.0,
                              threshold=0.375, starSize=7.0, glowSat=1.0, rolloff=2)),
            ("Intense",  dict(passes=6, baseSigma=12.0, growth=3.0, decay=1.0, strength=16.0,
                              threshold=0.375, starSize=7.0, glowSat=1.0, rolloff=2)),
            ("Extreme",  dict(passes=12, baseSigma=6.0, growth=1.5, decay=1.0, strength=30.0,
                              threshold=0.375, starSize=7.0, glowSat=1.0, rolloff=2)),
        ],
    },
    {   # ---------------- Non-Stellar (starless) ----------------
        "key": "nonstellar",
        # Defaults = the "Natural - Light" preset.
        "defaults": dict(passes=6, baseSigma=15.0, growth=3.0, decay=0.75, strength=0.30,
                         threshold=0.065, starSize=0.0, rolloff=2,
                         glowSat=1.0, scnrAmount=0.0, hlProtect=0.50, hlFeather=25.0,
                         keepGlow=False),
        "presets": [
            ("Natural - Light",    dict(passes=6, baseSigma=15.0, growth=3.0, decay=0.75,
                                        strength=0.30, threshold=0.065, glowSat=1.0,
                                        hlProtect=0.50, hlFeather=25.0, rolloff=2)),
            ("Natural - Moderate", dict(passes=6, baseSigma=15.0, growth=3.0, decay=0.75,
                                        strength=0.60, threshold=0.065, glowSat=1.0,
                                        hlProtect=0.50, hlFeather=25.0, rolloff=2)),
            ("Natural - Intense",  dict(passes=6, baseSigma=15.0, growth=3.0, decay=0.75,
                                        strength=0.90, threshold=0.065, glowSat=1.0,
                                        hlProtect=0.50, hlFeather=25.0, rolloff=2)),
        ],
    },
]
for _m in MODES:
    _m["params"] = dict(_m["defaults"])

ROLLOFF_NAMES = ["None (hard clip)", "Exponential", "Smooth (long shoulder)"]
INPUT_NAME0 = ["Stars-only", "Starless"]     # input item 0 label per mode
TOOL_NAMES = ["StarNet (run in Siril)", "StarXTerminator (RC-Astro)", "Starless image file"]
TOOL_KEYS = ["starnet", "sxt", "file"]
TOOL_STARNET, TOOL_SXT, TOOL_FILE = 0, 1, 2
REGION_NAMES = ["Whole image (1/3 res)", "Crop 1:1 (drag to pan)"]
PREVIEW_DOWNSAMPLE = 3
MAX_SIGMA = 250.0

UI = dict(mode=0, inputMode=0, tool=0, starlessFile="", rcAstroPath="", liveUpdate=True, region=0)


# ----------------------------------------------------------------------------
# Settings (JSON file in Siril's config folder)
# ----------------------------------------------------------------------------
def settings_path(siril):
    d = None
    try:
        d = siril.get_siril_configdir()
    except Exception:
        pass
    if not d or not os.path.isdir(d):
        d = os.path.expanduser("~")
    return os.path.join(d, "StellarRadiance.json")


def load_settings(siril):
    try:
        with open(settings_path(siril), "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return
    for M in MODES:
        stored = data.get(M["key"], {})
        for k, dv in M["defaults"].items():
            if k not in stored:
                continue
            v = stored[k]
            if isinstance(dv, bool):
                if isinstance(v, bool):
                    M["params"][k] = v
            elif isinstance(v, (int, float)) and not isinstance(v, bool):
                M["params"][k] = float(v) if isinstance(dv, float) else int(round(v))
        M["params"]["rolloff"] = max(0, min(len(ROLLOFF_NAMES) - 1, int(M["params"]["rolloff"])))
    for k in ("mode", "inputMode", "tool", "region"):
        if isinstance(data.get(k), int):
            UI[k] = data[k]
    UI["mode"] = max(0, min(1, UI["mode"]))
    UI["inputMode"] = max(0, min(1, UI["inputMode"]))
    # Star removal tool: stored by name. Settings from v1.5 and earlier stored
    # an index where 1 meant "Starless image file".
    if data.get("removalTool") in TOOL_KEYS:
        UI["tool"] = TOOL_KEYS.index(data["removalTool"])
    elif UI["tool"] == 1:
        UI["tool"] = TOOL_FILE
    UI["tool"] = max(0, min(len(TOOL_NAMES) - 1, UI["tool"]))
    if isinstance(data.get("rcAstroPath"), str):
        UI["rcAstroPath"] = data["rcAstroPath"]
    UI["region"] = max(0, min(1, UI["region"]))
    if isinstance(data.get("liveUpdate"), bool):
        UI["liveUpdate"] = data["liveUpdate"]
    if isinstance(data.get("starlessFile"), str):
        UI["starlessFile"] = data["starlessFile"]


def save_settings(siril):
    data = dict(UI)
    data["removalTool"] = TOOL_KEYS[UI["tool"]]
    for M in MODES:
        data[M["key"]] = M["params"]
    try:
        with open(settings_path(siril), "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        try:
            siril.log("StellarRadiance: could not save settings: %s" % e)
        except Exception:
            pass


# ----------------------------------------------------------------------------
# Pixel helpers. Images are float32 arrays shaped (channels, height, width)
# with values in 0..1.
# ----------------------------------------------------------------------------
def is_8bit(a):
    """uint16 data whose values never exceed 255 = an 8-bit image in Siril.
    (A real 16-bit image that dark would be black anyway.)"""
    return a.dtype == np.uint8 or (a.dtype == np.uint16 and int(a.max()) <= 255)


def to_float(a):
    a = np.asarray(a)
    if a.ndim == 2:
        a = a[None, :, :]
    if a.dtype == np.uint16:
        # Siril keeps 8-bit images (PNG, JPEG, 8-bit TIFF) in 16-bit buffers
        # with values 0..255, so scale by the real range.
        return a.astype(np.float32) / (255.0 if is_8bit(a) else 65535.0)
    if a.dtype == np.uint8:
        return a.astype(np.float32) / 255.0
    return np.clip(a.astype(np.float32), 0.0, 1.0)


def from_float(a, dtype, ndim):
    a = np.clip(a, 0.0, 1.0)
    if dtype == np.uint16:
        out = np.round(a * 65535.0).astype(np.uint16)
    else:
        out = a.astype(np.float32)
    if ndim == 2:
        out = out[0]
    return np.ascontiguousarray(out)


def luminance(img):
    """Rec.709 luminance, shape (1, H, W)."""
    if img.shape[0] == 3:
        return (0.2126 * img[0] + 0.7152 * img[1] + 0.0722 * img[2])[None, :, :]
    return img[:1]


def screen(a, b):
    return 1.0 - (1.0 - a) * (1.0 - b)


def _fft_apply(img, pad, make_transfer):
    """Apply a radially symmetric frequency-domain filter to every channel.
    make_transfer(r2) gets r2 = fx^2 + fy^2 (cycles/px squared) and returns
    the transfer function. Edges are mirror-padded by 'pad' pixels."""
    C, H, W = img.shape
    py, px = min(pad, H), min(pad, W)
    Hp, Wp = H + 2 * py, W + 2 * px
    Hf = sfft.next_fast_len(Hp, real=True)
    Wf = sfft.next_fast_len(Wp, real=True)
    fy = sfft.fftfreq(Hf).astype(np.float32)[:, None]
    fx = sfft.rfftfreq(Wf).astype(np.float32)[None, :]
    T = make_transfer(fy * fy + fx * fx).astype(np.float32)
    out = np.empty((C, H, W), dtype=np.float32)
    for c in range(C):
        a = np.pad(img[c], ((py, py), (px, px)), mode="symmetric")
        F = sfft.rfft2(a, s=(Hf, Wf), workers=-1)
        F *= T
        b = sfft.irfft2(F, s=(Hf, Wf), workers=-1)
        out[c] = b[py:py + H, px:px + W]
    return out


def gaussian_blur(img, sigma):
    """Gaussian blur with mirrored edges (spatial for small sigma, FFT above)."""
    if sigma <= 0:
        return img.copy()
    sigma = max(0.1, sigma)
    if sigma <= 4.0:
        return np.stack([ndimage.gaussian_filter(c, sigma, mode="reflect", truncate=4.0)
                         for c in img]).astype(np.float32)
    k = -2.0 * math.pi ** 2 * sigma * sigma
    return _fft_apply(img, int(math.ceil(3 * sigma)) + 2, lambda r2: np.exp(k * r2))


def downsample(img, f=PREVIEW_DOWNSAMPLE):
    C, H, W = img.shape
    h, w = max(1, H // f), max(1, W // f)
    a = np.asarray(img[:, :h * f, :w * f], dtype=np.float32)
    return a.reshape(C, h, f, w, f).mean(axis=(2, 4)).astype(np.float32)


def apply_scnr(img, amount):
    """SCNR green removal, average neutral protection, lightness preserved
    (luminance is restored after the green channel is reduced)."""
    r, g, b = img[0], img[1], img[2]
    m = 0.5 * (r + b)
    g2 = g * (1.0 - amount) + np.minimum(g, m) * amount
    y0 = 0.2126 * r + 0.7152 * g + 0.0722 * b
    y1 = 0.2126 * r + 0.7152 * g2 + 0.0722 * b
    k = np.where(y1 > 1e-6, y0 / np.maximum(y1, 1e-6), 1.0)
    return np.clip(np.stack([r * k, g2 * k, b * k]), 0.0, 1.0).astype(np.float32)


def num_passes(P):
    return max(1, int(round(P["passes"])))


def pass_sigmas(P):
    out, s_ = [], P["baseSigma"]
    for _ in range(num_passes(P)):
        out.append(min(s_, MAX_SIGMA))
        s_ *= P["growth"]
    return out


def effective_sigma(P):
    return math.sqrt(sum(c * c for c in pass_sigmas(P)))


def selection_pad(P, mode):
    p = 0.0 if mode == MODE_OBJECT else P["starSize"]
    if P["hlProtect"] > 0:
        p = max(p, P["hlFeather"])
    return p


def build_glow(src, P, mode, scale=1.0, want_glow=False, log=None):
    """Core algorithm, shared by the preview and the final run.
    src: float32 (C,H,W) 0..1. scale > 1 when src is a downsampled copy: all
    pixel-based settings are divided by it so the glow keeps the same size
    relative to the frame. Returns (result, glow or None)."""
    sc = scale if scale and scale > 0 else 1.0
    is_color = src.shape[0] == 3
    base = src.astype(np.float32, copy=True)

    # 1a) Non-Stellar: only the part of the signal above the threshold blooms.
    if mode == MODE_OBJECT:
        t = P["threshold"]
        if t > 0:
            base = np.maximum(0.0, (base - t) / (1.0 - t)).astype(np.float32)
    # 1b) Stellar: threshold + optional small-star rejection. A selection copy
    #     is blurred by the star-size sigma, so small stars fall below the
    #     threshold while big bright ones survive.
    elif P["threshold"] > 0 or P["starSize"] > 0:
        sel = gaussian_blur(src, P["starSize"] / sc) if P["starSize"] > 0 else src
        t = P["threshold"]
        bw = max(0.01, (1.0 - t) * 0.25)
        base = base * np.clip((sel - t) / bw, 0.0, 1.0)
        del sel

    # 2) Decaying, normalized weights
    n = num_passes(P)
    weights = [P["decay"] ** k for k in range(n)]
    wsum = sum(weights)

    # 3) The cascade. Blurring the previous result with sigma_k is the same
    #    as blurring the base with sqrt(sum of sigma_i^2 up to k), so the
    #    whole weighted sum of passes is a single filter in Fourier space:
    #       glow = base * sum_k w_k * Gauss(cumulative sigma_k)
    sigmas = pass_sigmas(P)
    variances, v = [], 0.0
    for k, s_ in enumerate(sigmas):
        s_ = max(0.1, s_ / sc)
        v += s_ * s_
        variances.append(v)
        if log:
            log("  pass %d: sigma %.2f px, effective sigma %.2f px, weight %.4f"
                % (k + 1, sigmas[k], math.sqrt(v) * sc, P["strength"] * weights[k] / wsum))
    coef = [P["strength"] * w / wsum for w in weights]
    two_pi2 = 2.0 * math.pi ** 2

    def transfer(r2):
        T = np.zeros_like(r2)
        for c, var in zip(coef, variances):
            T += np.float32(c) * np.exp(np.float32(-two_pi2 * var) * r2)
        return T

    pad = int(math.ceil(3.0 * math.sqrt(variances[-1]))) + 2
    glow = np.maximum(_fft_apply(base, pad, transfer), 0.0)
    del base

    # 4) Highlight rolloff (the accumulation is not clipped first, so the
    #    rolloff sees the true glow values).
    if P["rolloff"] == 1:
        glow = 1.0 - np.exp(-glow)
    elif P["rolloff"] == 2:
        glow = glow / (1.0 + glow)
    glow = np.clip(glow, 0.0, 1.0).astype(np.float32)

    # 5) Glow saturation (colour only): c' = L + (c - L) * saturation
    if is_color and abs(P["glowSat"] - 1.0) > 1e-3:
        L = luminance(glow)
        glow = np.clip(L + (glow - L) * P["glowSat"], 0.0, 1.0).astype(np.float32)

    # 5b) Highlight protection: glow' = glow * (1 - protection * mask), where
    #     the mask is the (feathered) lightness of the layer being glowed.
    if P["hlProtect"] > 0:
        mask = luminance(src).astype(np.float32)
        if P["hlFeather"] > 0:
            mask = gaussian_blur(mask, P["hlFeather"] / sc)
        glow = (glow * (1.0 - P["hlProtect"] * mask)).astype(np.float32)
        del mask

    # 6) Screen the glow onto the layer
    result = np.clip(screen(src, glow), 0.0, 1.0).astype(np.float32)

    # 7) SCNR on the stars + glow only (before any recombination)
    if mode == MODE_STARS and is_color and P["scnrAmount"] > 0:
        result = apply_scnr(result, P["scnrAmount"])

    return result, (glow if want_glow else None)


def unscreen_stars(orig, starless):
    return np.clip(1.0 - (1.0 - orig) / np.maximum(1e-6, 1.0 - starless), 0.0, 1.0).astype(np.float32)


def to_qimage(img):
    """float (C,h,w) 0..1 -> QImage (copied)."""
    a = np.clip(img, 0.0, 1.0)
    if a.shape[0] == 1:
        a = np.repeat(a, 3, axis=0)
    a8 = np.ascontiguousarray((np.transpose(a, (1, 2, 0)) * 255.0 + 0.5).astype(np.uint8))
    h, w = a8.shape[:2]
    # Hand Qt a complete in-memory PPM file: Qt decodes it into an image that
    # owns its own pixels, so there are no buffer lifetime / stride issues.
    q = QtGui.QImage.fromData(b"P6\n%d %d\n255\n" % (w, h) + a8.tobytes(), "PPM")
    if q.isNull():
        buf = a8.tobytes()
        q = QtGui.QImage(buf, w, h, 3 * w, QtGui.QImage.Format.Format_RGB888).copy()
    return q


def looks_linear(img):
    """True if the image is probably still linear (unstretched): the median
    brightness is tiny. Siril's AutoStretch view can hide this."""
    step = max(1, int(math.sqrt(img.shape[1] * img.shape[2] / 250000.0)))
    return float(np.median(luminance(img[:, ::step, ::step]))) < 0.02


def find_rc_astro():
    """Path to RC-Astro's command-line tool, or None."""
    p = UI.get("rcAstroPath", "")
    if p and os.path.isfile(p):
        return p
    for name in ("rc-astro", "rc-astro.exe"):
        w = shutil.which(name)
        if w:
            return w
    pats = []
    if sys.platform.startswith("win"):
        for root in (os.environ.get("ProgramFiles", r"C:\Program Files"),
                     os.environ.get("ProgramFiles(x86)", ""),
                     os.environ.get("LOCALAPPDATA", "")):
            if root:
                pats += [os.path.join(root, "RC-Astro", "rc-astro.exe"),
                         os.path.join(root, "RC-Astro", "*", "rc-astro.exe"),
                         os.path.join(root, "RC Astro", "*rc-astro.exe"),
                         os.path.join(root, "Programs", "RC-Astro", "*rc-astro.exe")]
    elif sys.platform == "darwin":
        pats += ["/usr/local/bin/rc-astro", "/opt/homebrew/bin/rc-astro",
                 "/Applications/RC-Astro*/rc-astro", "/Applications/RC-Astro*.app/Contents/MacOS/rc-astro"]
    else:
        pats += ["/usr/local/bin/rc-astro", "/usr/bin/rc-astro", "/opt/rc-astro/rc-astro",
                 "/opt/RC-Astro/rc-astro", os.path.expanduser("~/.local/bin/rc-astro")]
    for pat in pats:
        for f in glob.glob(pat):
            if os.path.isfile(f):
                return f
    return None


def run_process(cmd, on_tick=None, timeout=3600.0):
    """Run an external program while keeping the window responsive.
    Returns its output lines; raises if it fails."""
    kw = {}
    if sys.platform.startswith("win"):
        kw["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, errors="replace", **kw)
    lines = []

    def reader():
        for line in proc.stdout:
            lines.append(line.rstrip())
    th = threading.Thread(target=reader, daemon=True)
    th.start()
    t0 = time.time()
    while proc.poll() is None:
        QtWidgets.QApplication.processEvents()
        time.sleep(0.1)
        if on_tick:
            on_tick(int(time.time() - t0))
        if time.time() - t0 > timeout:
            proc.kill()
            raise RuntimeError("%s timed out." % os.path.basename(cmd[0]))
    th.join(timeout=2.0)
    if proc.returncode != 0:
        tail = "\n".join(l for l in lines[-10:] if l)
        raise RuntimeError("%s failed (exit code %d)%s" % (os.path.basename(cmd[0]), proc.returncode,
                                                         (":\n" + tail) if tail else "."))
    return lines


# Siril stores rows bottom-up (FITS order). The preview shows a flipped view
# so the picture is the right way up; processing doesn't care about row order.
def disp(a):
    return a[:, ::-1, :]


# ----------------------------------------------------------------------------
# GUI
# ----------------------------------------------------------------------------
class Numeric(QtWidgets.QWidget):
    """Label + spin box + slider, like PixInsight's NumericControl."""
    valueChanged = QtCore.pyqtSignal(float)

    def __init__(self, text, lo, hi, prec, tip, label_w, parent=None):
        super().__init__(parent)
        self.lo, self.hi, self.prec = lo, hi, prec
        lay = QtWidgets.QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(6)
        self.label = QtWidgets.QLabel(text)
        self.label.setFixedWidth(label_w)
        self.label.setAlignment(QtCore.Qt.AlignmentFlag.AlignRight | QtCore.Qt.AlignmentFlag.AlignVCenter)
        self.spin = QtWidgets.QDoubleSpinBox()
        self.spin.setDecimals(prec)
        self.spin.setRange(lo, hi)
        self.spin.setSingleStep(10 ** -prec if prec > 0 else 1)
        self.spin.setKeyboardTracking(False)
        self.slider = QtWidgets.QSlider(QtCore.Qt.Orientation.Horizontal)
        self.slider.setRange(0, 1000)
        self.slider.setMinimumWidth(200)
        lay.addWidget(self.label)
        lay.addWidget(self.spin)
        lay.addWidget(self.slider, 1)
        for w in (self.label, self.spin, self.slider):
            w.setToolTip(tip)
        self.spin.valueChanged.connect(self._spin_changed)
        self.slider.valueChanged.connect(self._slider_changed)

    def _to_slider(self, v):
        return int(round((v - self.lo) / (self.hi - self.lo) * 1000))

    def setValue(self, v):
        self.spin.blockSignals(True)
        self.slider.blockSignals(True)
        self.spin.setValue(v)
        self.slider.setValue(self._to_slider(self.spin.value()))
        self.spin.blockSignals(False)
        self.slider.blockSignals(False)

    def _slider_changed(self, i):
        v = round(self.lo + (self.hi - self.lo) * i / 1000.0, self.prec)
        self.spin.blockSignals(True)
        self.spin.setValue(v)
        self.spin.blockSignals(False)
        self.valueChanged.emit(self.spin.value())

    def _spin_changed(self, v):
        self.slider.blockSignals(True)
        self.slider.setValue(self._to_slider(v))
        self.slider.blockSignals(False)
        self.valueChanged.emit(v)


class PreviewWidget(QtWidgets.QWidget):
    def __init__(self, owner):
        super().__init__()
        self.owner = owner
        self.setMinimumSize(500, 500)
        self.setSizePolicy(QtWidgets.QSizePolicy.Policy.Expanding, QtWidgets.QSizePolicy.Policy.Expanding)
        self.dragging = False
        self.drag0 = None
        self.dragD = QtCore.QPoint(0, 0)

    def paintEvent(self, ev):
        p = QtGui.QPainter(self)
        p.fillRect(self.rect(), QtGui.QColor(24, 24, 24))
        img = self.owner.current_bitmap()
        if img is not None:
            if img.width() > self.width() or img.height() > self.height():
                img = img.scaled(self.width(), self.height(), QtCore.Qt.AspectRatioMode.KeepAspectRatio,
                                 QtCore.Qt.TransformationMode.SmoothTransformation)
            ox = (self.width() - img.width()) // 2 + self.dragD.x()
            oy = (self.height() - img.height()) // 2 + self.dragD.y()
            p.drawImage(ox, oy, img)
        if self.owner.busy:
            p.setPen(QtGui.QColor(255, 204, 0))
            p.drawText(8, 18, "Rendering...")
        p.end()

    def mousePressEvent(self, ev):
        if self.owner.region != 1 or ev.button() != QtCore.Qt.MouseButton.LeftButton:
            return
        self.dragging = True
        self.drag0 = ev.position().toPoint()

    def mouseMoveEvent(self, ev):
        if not self.dragging:
            return
        self.dragD = ev.position().toPoint() - self.drag0
        self.update()

    def mouseReleaseEvent(self, ev):
        if not self.dragging:
            return
        self.dragging = False
        d = ev.position().toPoint() - self.drag0
        self.dragD = QtCore.QPoint(0, 0)
        self.owner.pan_by(d.x(), d.y())

    def resizeEvent(self, ev):
        self.owner.on_preview_resized()


class StellarRadianceWindow(QtWidgets.QWidget):
    def __init__(self, siril):
        super().__init__()
        self.siril = siril
        raw = siril.get_image_pixeldata()
        self.src_8bit = is_8bit(raw)
        # 8-bit sources are written back as 32-bit float: a smooth glow would
        # band badly in 8 bits, and Siril's 0..255 convention doesn't survive
        # StarNet (which converts the image to 32-bit).
        self.raw_dtype = np.dtype(np.float32) if self.src_8bit else raw.dtype
        self.raw_ndim = raw.ndim
        self.raw = raw                       # kept to restore after StarNet
        self.orig = to_float(raw)            # (C,H,W), Siril row order
        self.C, self.H, self.W = self.orig.shape
        self.is_color = self.C == 3
        try:
            self.filename = siril.get_image_filename() or ""
        except Exception:
            self.filename = ""

        self.stars_cache = None      # dict(key, starless, stars) full res
        self.small = dict(orig=None, starless=None, stars=None, key=None)
        self.cx, self.cy = self.W / 2.0, self.H / 2.0   # crop centre (display coords)
        self.busy = False
        self.syncing = False
        self.before_img = None
        self.after_img = None
        self.region = UI["region"]
        self.numerics = {}

        self.timer = QtCore.QTimer(self)
        self.timer.setSingleShot(True)
        self.timer.setInterval(350)
        self.timer.timeout.connect(lambda: self.update_preview(False))
        self.resize_timer = QtCore.QTimer(self)
        self.resize_timer.setSingleShot(True)
        self.resize_timer.setInterval(400)
        self.resize_timer.timeout.connect(lambda: self.update_preview(False))

        try:
            lum = luminance(self.orig[:, ::4, ::4])
            siril.log("StellarRadiance: image %dx%d, %d channel(s), %s data, min %.4f median %.4f max %.4f"
                      % (self.W, self.H, self.C, "8-bit" if self.src_8bit else self.raw_dtype, float(lum.min()),
                         float(np.median(lum)), float(lum.max())))
        except Exception:
            pass
        self.linear_warning = ""
        if looks_linear(self.orig):
            self.linear_warning = ("This image looks LINEAR (unstretched), so the preview will look "
                                   "almost black. Siril's AutoStretch view only changes the display: "
                                   "stretch the image for real (Histogram, Asinh or GHS) first.")
            try:
                siril.log("StellarRadiance: " + self.linear_warning)
            except Exception:
                pass

        self.build_ui()
        self.apply_mode_to_controls()
        self.update_input_controls()
        self.update_region_controls()
        QtCore.QTimer.singleShot(0, lambda: self.update_preview(False))

    # ---- parameters ------------------------------------------------------
    @property
    def mode(self):
        return UI["mode"]

    @property
    def G(self):
        return MODES[UI["mode"]]["params"]

    def matching_preset(self):
        for i, (_, v) in enumerate(MODES[self.mode]["presets"]):
            if all(abs(float(self.G[k]) - float(x)) <= 1e-3 for k, x in v.items()):
                return i
        return -1

    # ---- UI construction -------------------------------------------------
    def build_ui(self):
        self.setWindowTitle("%s v%s (%s)" % (TITLE, VERSION, EDITION))
        fm = self.fontMetrics()
        lw = fm.horizontalAdvance("Highlight protection:") + 12

        def row_label(text):
            l = QtWidgets.QLabel(text)
            l.setFixedWidth(lw)
            l.setAlignment(QtCore.Qt.AlignmentFlag.AlignRight | QtCore.Qt.AlignmentFlag.AlignVCenter)
            return l

        def hrow(*widgets, stretch=True):
            h = QtWidgets.QHBoxLayout()
            h.setSpacing(6)
            for w in widgets:
                h.addWidget(w)
            if stretch:
                h.addStretch(1)
            return h

        left = QtWidgets.QVBoxLayout()
        left.setSpacing(6)

        self.help_label = QtWidgets.QLabel()
        self.help_label.setWordWrap(True)
        self.help_label.setTextFormat(QtCore.Qt.TextFormat.RichText)
        self.help_label.setFrameShape(QtWidgets.QFrame.Shape.Box)
        self.help_label.setMargin(6)
        self.help_label.setMinimumWidth(380)
        left.addWidget(self.help_label)

        # Glow target
        self.mode_combo = QtWidgets.QComboBox()
        self.mode_combo.addItems(MODE_NAMES)
        self.mode_combo.setCurrentIndex(self.mode)
        self.mode_combo.setToolTip(
            "Stellar: glow around stars (stars-only image, or the stars of a combined image).\n"
            "Non-Stellar: soft bloom on nebulae / galaxies (starless image, or the starless part of a "
            "combined image; stars are added back unglowed).\nEach target keeps its own settings and presets.")
        self.mode_combo.currentIndexChanged.connect(self.on_mode)
        left.addLayout(hrow(row_label("Glow target:"), self.mode_combo))

        # Input
        self.input_combo = QtWidgets.QComboBox()
        self.input_combo.addItems([INPUT_NAME0[self.mode], "Combined"])
        self.input_combo.setCurrentIndex(UI["inputMode"])
        self.input_combo.setToolTip(
            "Stars-only (Stellar) / Starless (Non-Stellar): the image is already separated.\n"
            "Combined: an image with both stars and background. Stars are separated first, the "
            "target layer is glowed, then both are recombined.")
        self.input_combo.currentIndexChanged.connect(self.on_input)
        left.addLayout(hrow(row_label("Input:"), self.input_combo))

        # Star removal
        self.tool_label = row_label("Star removal:")
        self.tool_combo = QtWidgets.QComboBox()
        self.tool_combo.addItems(TOOL_NAMES)
        self.tool_combo.setCurrentIndex(UI["tool"])
        self.tool_combo.setToolTip(
            "StarNet: runs Siril's StarNet integration once (StarNet CLI must be set up in Siril's "
            "Preferences).\nStarXTerminator: runs RC-Astro's stand-alone command-line tool (rc-astro), "
            "which needs an activated StarXTerminator license.\nStarless image file: use a starless "
            "version of this image that you made elsewhere. It must be the same size.")
        self.tool_combo.currentIndexChanged.connect(self.on_tool)
        left.addLayout(hrow(self.tool_label, self.tool_combo))

        self.file_button = QtWidgets.QPushButton("Choose file...")
        self.file_button.clicked.connect(self.on_choose_file)
        self.file_label = QtWidgets.QLabel()
        self.file_label.setWordWrap(True)
        self.file_spacer = QtWidgets.QLabel()
        self.file_spacer.setFixedWidth(lw)
        frow = QtWidgets.QHBoxLayout()
        frow.addWidget(self.file_spacer)
        frow.addWidget(self.file_button)
        frow.addWidget(self.file_label, 1)
        left.addLayout(frow)

        # Preset
        self.preset_combo = QtWidgets.QComboBox()
        self.preset_combo.setToolTip("Load a preset. Any change to a setting switches this to Custom.")
        self.preset_combo.currentIndexChanged.connect(self.on_preset)
        left.addSpacing(4)
        left.addLayout(hrow(row_label("Preset:"), self.preset_combo))
        left.addSpacing(4)

        def add_numeric(text, lo, hi, prec, key, tip):
            c = Numeric(text, lo, hi, prec, tip, lw)
            c.setValue(self.G[key])

            def changed(v, key=key):
                if self.syncing:
                    return
                self.G[key] = int(round(v)) if key == "passes" else float(v)
                self.update_preset_combo()
                self.schedule_preview()
            c.valueChanged.connect(changed)
            self.numerics[key] = c
            left.addWidget(c)
            return c

        add_numeric("Blur passes:", 1, 12, 0, "passes",
                    "How many blur passes. More passes = wider, smoother falloff.")
        add_numeric("First pass sigma:", 0.5, 20, 2, "baseSigma",
                    "Gaussian sigma (pixels) of the first, tightest pass. Larger values suit large-scale objects.")
        add_numeric("Sigma growth factor:", 1.1, 3, 2, "growth",
                    "Each pass's sigma is the previous one multiplied by this.")
        add_numeric("Weight decay:", 0.3, 1, 2, "decay",
                    "How quickly outer halos fade. Lower = tighter glow; 1.0 = all passes equal.")
        add_numeric("Glow strength:", 0.05, 30, 2, "strength",
                    "Overall intensity of the glow. Values above ~3 give very strong, bloomy halos; "
                    "10-30 is extreme. Type a value in the box for fine control.")
        add_numeric("Threshold:", 0, 0.98, 3, "threshold",
                    "Stellar: only stars brighter than this glow (sharp cutoff).\n"
                    "Non-Stellar: only brightness above this level blooms, so faint background stays dark.")
        add_numeric("Star size filter:", 0, 10, 1, "starSize",
                    "Rejects small stars (px). Stars are blurred by this amount before the threshold test, "
                    "so small stars fall below it while big ones survive. 0 = off.")
        add_numeric("Glow saturation:", 0, 3, 2, "glowSat",
                    "Colour saturation of the glow only (stars and background are untouched). "
                    "0 = white glow, 1 = natural, above 1 = more colourful halos. No effect on mono images.")
        add_numeric("Highlight protection:", 0, 1, 2, "hlProtect",
                    "Lightness mask that holds the glow back from areas that are already bright, so intense "
                    "glow doesn't wash out cores and highlights. 0 = off, 1 = no glow added on pure white.")
        add_numeric("Mask feather:", 0, 50, 1, "hlFeather",
                    "Softens the highlight-protection mask (blur radius in px). Only used when Highlight "
                    "protection is above 0.")
        add_numeric("SCNR amount:", 0, 1, 2, "scnrAmount",
                    "Removes green cast from the stars and their glow (average neutral, lightness preserved). "
                    "0 = off, 1 = full SCNR. The starless background is not affected. No effect on mono images.")
        self.numerics["glowSat"].setEnabled(self.is_color)
        self.numerics["scnrAmount"].setEnabled(self.is_color)

        self.rolloff_combo = QtWidgets.QComboBox()
        self.rolloff_combo.addItems(ROLLOFF_NAMES)
        self.rolloff_combo.setToolTip("How the glow is compressed as it approaches white. "
                                      "Smooth gives the most natural falloff at high strengths.")
        self.rolloff_combo.currentIndexChanged.connect(self.on_rolloff)
        left.addLayout(hrow(row_label("Highlight rolloff:"), self.rolloff_combo))

        sp1 = QtWidgets.QLabel()
        sp1.setFixedWidth(lw)
        self.keep_check = QtWidgets.QCheckBox("Also save the glow layer as a FITS file")
        self.keep_check.toggled.connect(lambda c: self.G.__setitem__("keepGlow", bool(c)))
        left.addLayout(hrow(sp1, self.keep_check))

        sp2 = QtWidgets.QLabel()
        sp2.setFixedWidth(lw)
        self.adv_check = QtWidgets.QCheckBox("Show advanced settings")
        self.adv_check.setToolTip("Show First pass sigma, Sigma growth factor, Weight decay, Threshold and "
                                  "Star size filter. Their values are always used, even when hidden.")
        self.adv_check.toggled.connect(lambda c: self.update_advanced_controls())
        left.addLayout(hrow(sp2, self.adv_check))
        left.addStretch(1)

        # Buttons
        self.reset_button = QtWidgets.QPushButton("Reset")
        self.reset_button.setToolTip("Restore the current glow target's settings to their defaults.")
        self.reset_button.clicked.connect(self.on_reset)
        self.apply_button = QtWidgets.QPushButton("Apply")
        self.apply_button.setDefault(True)
        self.apply_button.setToolTip("Apply to the image loaded in Siril (undoable) and close.")
        self.apply_button.clicked.connect(self.on_apply)
        self.close_button = QtWidgets.QPushButton("Close")
        self.close_button.clicked.connect(self.close)
        brow = QtWidgets.QHBoxLayout()
        brow.addWidget(self.reset_button)
        brow.addStretch(1)
        brow.addWidget(self.apply_button)
        brow.addWidget(self.close_button)
        left.addLayout(brow)

        # Right side: preview
        self.live_check = QtWidgets.QCheckBox("Live update")
        self.live_check.setChecked(UI["liveUpdate"])
        self.live_check.setToolTip("Re-render the preview automatically when a setting changes.")
        self.live_check.toggled.connect(self.on_live)
        self.orig_check = QtWidgets.QCheckBox("Show original")
        self.orig_check.setToolTip("Toggle to compare before / after.")
        self.orig_check.toggled.connect(lambda c: self.preview.update())
        self.region_combo = QtWidgets.QComboBox()
        self.region_combo.addItems(REGION_NAMES)
        self.region_combo.setCurrentIndex(self.region)
        self.region_combo.setToolTip("Whole image: the full frame processed at 1/3 resolution and fitted to the "
                                     "preview (fast overview; fine star detail is approximate).\n"
                                     "Crop 1:1: a full-resolution crop you can drag around.")
        self.region_combo.currentIndexChanged.connect(self.on_region)
        self.center_button = QtWidgets.QPushButton("Center")
        self.center_button.setToolTip("Move the preview back to the image centre.")
        self.center_button.clicked.connect(self.on_center)
        self.preview_button = QtWidgets.QPushButton("Preview")
        self.preview_button.setToolTip("Re-render the preview. With Combined input this also runs star removal "
                                       "the first time (it never runs automatically, as it can be slow).")
        self.preview_button.clicked.connect(lambda: self.update_preview(True))

        orow = QtWidgets.QHBoxLayout()
        orow.addWidget(self.live_check)
        orow.addWidget(self.orig_check)
        orow.addStretch(1)
        orow.addWidget(QtWidgets.QLabel("Region:"))
        orow.addWidget(self.region_combo)
        orow.addWidget(self.center_button)
        orow.addWidget(self.preview_button)

        self.preview = PreviewWidget(self)
        self.status_label = QtWidgets.QLabel("")

        right = QtWidgets.QVBoxLayout()
        right.setSpacing(4)
        right.addLayout(orow)
        right.addWidget(self.preview, 1)
        right.addWidget(self.status_label)

        self.fit_widths()

        main = QtWidgets.QHBoxLayout(self)
        main.setContentsMargins(8, 8, 8, 8)
        main.setSpacing(10)
        main.addLayout(left)
        main.addLayout(right, 1)

    def fit_widths(self):
        """Make every drop-down and value box wide enough for its longest text,
        including items that only appear in the other mode."""
        fm = self.fontMetrics()

        def fit_combo(combo, texts):
            w = max(fm.horizontalAdvance(t) for t in texts)
            combo.setSizeAdjustPolicy(QtWidgets.QComboBox.SizeAdjustPolicy.AdjustToContents)
            combo.setMinimumWidth(w + 56)               # text + arrow + frame
            combo.view().setMinimumWidth(w + 40)        # the open list too

        fit_combo(self.mode_combo, MODE_NAMES)
        fit_combo(self.input_combo, INPUT_NAME0 + ["Combined"])
        fit_combo(self.tool_combo, TOOL_NAMES)
        fit_combo(self.preset_combo, ["Custom"] + [n for M in MODES for n, _ in M["presets"]])
        fit_combo(self.rolloff_combo, ROLLOFF_NAMES)
        fit_combo(self.region_combo, REGION_NAMES)

        # Value boxes: one common width, based on the widest number any of
        # them can show (e.g. "30.00", "0.980") plus the up/down buttons.
        widest = 0
        for c in self.numerics.values():
            for v in (c.lo, c.hi):
                widest = max(widest, fm.horizontalAdvance("%.*f" % (c.prec, v)),
                             c.spin.sizeHint().width() - 40)
        sw = widest + 48
        for c in self.numerics.values():
            c.spin.setFixedWidth(max(sw, c.spin.sizeHint().width()))

    def help_text(self):
        # Same text and layout as the PixInsight version's info box.
        head = "<p><b>%s v%s (%s)</b> | %s</p>" % (TITLE, VERSION, EDITION, AUTHOR)
        if self.mode == MODE_OBJECT:
            body = ("<p>Adds a soft bloom to nebulae and galaxies using iterative Gaussian blur passes. "
                    "Run on a stretched starless image, or on a combined image with <i>Input</i> set to "
                    "<i>Combined</i> to remove stars first.</p>")
        else:
            body = ("<p>Adds a realistic glow to stars using iterative Gaussian blur passes. "
                    "Run on a stretched stars-only image, or on a combined image with <i>Input</i> set to "
                    "<i>Combined</i> to remove stars first.</p>")
        start = "<p><i>Press the Preview button to start processing.</i></p>"
        if getattr(self, "linear_warning", ""):
            start += "<p style='color:#e0a000'><b>Warning:</b> %s</p>" % self.linear_warning
        return head + body + start

    # ---- control syncing -------------------------------------------------
    def sync_controls(self):
        self.syncing = True
        for k, c in self.numerics.items():
            c.setValue(self.G[k])
        self.rolloff_combo.setCurrentIndex(int(self.G["rolloff"]))
        self.keep_check.setChecked(bool(self.G["keepGlow"]))
        self.syncing = False
        self.update_preset_combo()

    def rebuild_preset_combo(self):
        self.syncing = True
        self.preset_combo.clear()
        self.preset_combo.addItem("Custom")
        for n, _ in MODES[self.mode]["presets"]:
            self.preset_combo.addItem(n)
        self.syncing = False

    def update_preset_combo(self):
        was = self.syncing
        self.syncing = True
        self.preset_combo.setCurrentIndex(self.matching_preset() + 1)
        self.syncing = was

    def apply_mode_to_controls(self):
        self.input_combo.setItemText(0, INPUT_NAME0[self.mode])
        self.rebuild_preset_combo()
        self.sync_controls()
        self.update_advanced_controls()
        self.help_label.setText(self.help_text())

    def update_advanced_controls(self):
        adv = self.adv_check.isChecked()
        stars = self.mode == MODE_STARS
        for k in ("baseSigma", "growth", "decay", "threshold"):
            self.numerics[k].setVisible(adv)
        self.numerics["starSize"].setVisible(adv and stars)
        self.numerics["scnrAmount"].setVisible(stars)

    def update_input_controls(self):
        full = UI["inputMode"] == 1
        self.tool_combo.setEnabled(full)
        self.tool_label.setEnabled(full)
        show = full and UI["tool"] in (TOOL_SXT, TOOL_FILE)
        self.file_button.setVisible(show)
        self.file_label.setVisible(show)
        self.file_spacer.setVisible(show)
        if UI["tool"] == TOOL_SXT:
            exe = find_rc_astro()
            self.file_button.setText("Locate rc-astro...")
            self.file_button.setToolTip("Point to the rc-astro program if it isn't found automatically.")
            self.file_label.setText(os.path.basename(exe) + " found" if exe else
                                    "<i>rc-astro not found</i>")
            self.file_label.setToolTip(exe or "Install the RC-Astro CLI from rc-astro.com, or click "
                                              "Locate rc-astro... to point to it.")
        else:
            f = UI["starlessFile"]
            self.file_button.setText("Choose file...")
            self.file_button.setToolTip("Choose the starless version of this image.")
            self.file_label.setText(os.path.basename(f) if f else "<i>no file chosen</i>")
            self.file_label.setToolTip(f)

    def update_region_controls(self):
        free = self.region == 1
        self.center_button.setEnabled(free)
        self.preview.setToolTip("Drag to pan around the image." if free else
                                "Whole image at 1/3 resolution. Choose Crop 1:1 in the Region menu to inspect detail.")

    # ---- events ----------------------------------------------------------
    def schedule_preview(self):
        if not self.live_check.isChecked():
            return
        self.timer.start()

    def on_mode(self, i):
        if i == UI["mode"]:
            return
        UI["mode"] = i
        self.apply_mode_to_controls()
        self.schedule_preview()

    def on_input(self, i):
        UI["inputMode"] = i
        self.update_input_controls()
        self.schedule_preview()

    def on_tool(self, i):
        UI["tool"] = i
        self.update_input_controls()
        self.schedule_preview()

    def on_choose_file(self):
        if UI["tool"] == TOOL_SXT:
            start = os.path.dirname(UI["rcAstroPath"] or find_rc_astro() or "")
            f, _ = QtWidgets.QFileDialog.getOpenFileName(
                self, "Locate the rc-astro program", start,
                "rc-astro (rc-astro rc-astro.exe);;All files (*)")
            if f:
                UI["rcAstroPath"] = f
                self.update_input_controls()
                self.schedule_preview()
            return
        start = os.path.dirname(UI["starlessFile"] or self.filename or "")
        f, _ = QtWidgets.QFileDialog.getOpenFileName(
            self, "Choose the starless image", start,
            "Images (*.fit *.fits *.fts *.tif *.tiff *.xisf *.png);;All files (*)")
        if f:
            UI["starlessFile"] = f
            self.update_input_controls()
            self.schedule_preview()

    def on_preset(self, i):
        if self.syncing or i < 1:
            return
        _, v = MODES[self.mode]["presets"][i - 1]
        for k, x in v.items():
            self.G[k] = x
        self.sync_controls()
        self.update_preview(False)

    def on_rolloff(self, i):
        if self.syncing:
            return
        self.G["rolloff"] = i
        self.update_preset_combo()
        self.schedule_preview()

    def on_live(self, c):
        UI["liveUpdate"] = bool(c)
        if c:
            self.schedule_preview()

    def on_region(self, i):
        self.region = UI["region"] = i
        self.update_region_controls()
        self.update_preview(False)

    def on_center(self):
        self.cx, self.cy = self.W / 2.0, self.H / 2.0
        self.update_preview(False)

    def on_reset(self):
        M = MODES[self.mode]
        M["params"].clear()
        M["params"].update(M["defaults"])
        self.sync_controls()
        self.update_preview(False)

    def pan_by(self, dx, dy):
        self.cx -= dx       # drag right = look further left
        self.cy -= dy
        self.update_preview(False)

    def on_preview_resized(self):
        if self.busy:
            return
        if self.region == 1:
            self.resize_timer.start()
        else:
            self.preview.update()

    def current_bitmap(self):
        return self.before_img if self.orig_check.isChecked() else self.after_img

    def closeEvent(self, ev):
        self.timer.stop()
        self.resize_timer.stop()
        super().closeEvent(ev)

    # ---- star separation -------------------------------------------------
    def removal_key(self):
        return (UI["tool"], UI["starlessFile"] if UI["tool"] == TOOL_FILE else "")

    def stars_ready(self):
        return self.stars_cache is not None and self.stars_cache["key"] == self.removal_key()

    def run_starnet(self):
        self.siril.log("StellarRadiance: removing stars with StarNet...")
        try:
            self.siril.update_progress("StellarRadiance: removing stars with StarNet...", -1.0)
        except Exception:
            pass
        try:
            before = self.siril.get_image_filename() or ""
        except Exception:
            before = ""
        t_start = time.time()
        after = ""
        old_wd, tmp = self.enter_temp_wd()
        try:
            try:
                self.siril.cmd("starnet", "-nostarmask")
            except Exception as e:
                raise RuntimeError(
                    "StarNet failed (%s). Check that the StarNet command-line tool is set up in Siril's "
                    "Preferences, or choose 'Starless image file' instead." % e)
            # In Siril 1.4 the starnet command returns as soon as StarNet has
            # STARTED; it runs in Siril's processing thread and loads the
            # starless image when done. Wait for that before reading pixels.
            self.wait_for_starnet(before)
            starless = to_float(self.siril.get_image_pixeldata())
            try:
                after = self.siril.get_image_filename() or ""
            except Exception:
                after = ""
        finally:
            self.leave_temp_wd(old_wd, tmp)
            self.cleanup_starnet_files(t_start, before,
                                       [tmp, old_wd, os.path.dirname(before), os.path.dirname(after)])
            if tmp:
                shutil.rmtree(tmp, ignore_errors=True)
        if np.abs(starless - self.orig).max() < 1e-4:
            raise RuntimeError("StarNet returned an unchanged image. Check Siril's console for StarNet errors.")
        # Siril now shows the starless image; put the original pixels back.
        with self.siril.image_lock():
            self.siril.set_image_pixeldata(
                from_float(self.orig, np.float32, self.raw_ndim) if self.src_8bit else self.raw)
        self.siril.log("StellarRadiance: StarNet done, original pixels restored. Note: Siril has renamed "
                       "the loaded image with a 'starless_' prefix - use Save As with your own name.")
        return starless

    def get_wd(self):
        try:
            return self.siril.get_siril_wd() or None
        except Exception:
            return None

    def enter_temp_wd(self):
        """Point Siril's working directory at a private temp folder so StarNet
        writes its files there. Returns (old_wd, tmp); tmp is None if this
        wasn't possible (the files are then deleted from the normal folder)."""
        old_wd = self.get_wd()
        if not old_wd or " " in old_wd:          # Siril's cd can't take spaces safely
            return old_wd, None
        tmp = None
        try:
            tmp = tempfile.mkdtemp(prefix="StellarRadiance_")
            if " " in tmp:
                raise RuntimeError("temp path has spaces")
            self.siril.cmd("cd", tmp)
            now = self.get_wd() or ""
            if os.path.normcase(os.path.abspath(now)) != os.path.normcase(os.path.abspath(tmp)):
                raise RuntimeError("cd did not take effect")
            return old_wd, tmp
        except Exception:
            if tmp:
                shutil.rmtree(tmp, ignore_errors=True)
            try:
                if self.get_wd() != old_wd:
                    self.siril.cmd("cd", old_wd)
            except Exception:
                pass
            return old_wd, None

    def leave_temp_wd(self, old_wd, tmp):
        if tmp and old_wd:
            try:
                self.siril.cmd("cd", old_wd)
            except Exception as e:
                self.siril.log("StellarRadiance: could not restore the working directory "
                               "(%s): %s" % (old_wd, e))

    def cleanup_starnet_files(self, t_start, orig_name, folders):
        """Delete the starless_/starmask_ files StarNet wrote for this image
        during this run. Only files modified after StarNet started are
        touched, so older files of yours are never removed."""
        base = os.path.splitext(os.path.basename(orig_name))[0].lower() if orig_name else ""
        exts = (".fit", ".fits", ".fts", ".tif", ".tiff")
        seen = set()
        for d in folders:
            if not d or not os.path.isdir(d):
                continue
            key = os.path.normcase(os.path.abspath(d))
            if key in seen:
                continue
            seen.add(key)
            for f in os.listdir(d):
                fl = f.lower()
                if not (fl.startswith("starless_") or fl.startswith("starmask_")):
                    continue
                if not fl.endswith(exts) or (base and base not in fl):
                    continue
                path = os.path.join(d, f)
                try:
                    if os.path.getmtime(path) >= t_start - 2.0:
                        os.remove(path)
                        self.siril.log("StellarRadiance: removed StarNet file %s" % path)
                except Exception as e:
                    self.siril.log("StellarRadiance: could not remove %s: %s" % (path, e))

    def siril_idle(self):
        """True when Siril's processing thread is free."""
        try:
            with self.siril.image_lock():
                pass
            return True
        except Exception:
            return False

    def wait_for_starnet(self, before_name, timeout=3600.0):
        t0 = time.time()
        loaded_new = False
        while True:
            for _ in range(5):                      # keep the window responsive
                QtWidgets.QApplication.processEvents()
                time.sleep(0.1)
            try:
                name = self.siril.get_image_filename() or ""
            except Exception:
                name = before_name
            if name != before_name:
                loaded_new = True                   # starless image has been loaded
            idle = self.siril_idle()
            if loaded_new and idle:
                time.sleep(0.5)                     # let Siril finish saving / redrawing
                return
            if not loaded_new and idle and time.time() - t0 > 10.0:
                raise RuntimeError("StarNet finished without producing a starless image. "
                                   "Check Siril's console for StarNet errors.")
            if time.time() - t0 > timeout:
                raise RuntimeError("Timed out waiting for StarNet.")
            elapsed = int(time.time() - t0)
            self.status_label.setText("Removing stars with StarNet... %d s" % elapsed)

    def run_sxt(self):
        """StarXTerminator through RC-Astro's command-line tool. The image is
        written to a private temp folder, rc-astro makes the starless version
        there, it is read back and the folder is deleted."""
        exe = find_rc_astro()
        if not exe:
            raise RuntimeError("Couldn't find RC-Astro's command-line tool (rc-astro). Install it from "
                               "rc-astro.com and activate StarXTerminator, or click 'Locate rc-astro...'.")
        tmp = tempfile.mkdtemp(prefix="StellarRadiance_sxt_")
        try:
            inp = os.path.join(tmp, "sr_input.fit")
            self.siril.save_image_file(from_float(self.orig, np.float32, self.raw_ndim), filename=inp)
            if not os.path.isfile(inp):
                found = [f for f in glob.glob(os.path.join(tmp, "sr_input*")) if os.path.isfile(f)]
                if not found:
                    raise RuntimeError("Could not write the temporary image for StarXTerminator.")
                inp = found[0]
            outdir = os.path.join(tmp, "out")
            os.makedirs(outdir)
            self.siril.log("StellarRadiance: removing stars with StarXTerminator (%s)..." % exe)
            lines = run_process([exe, "sxt", inp, "--output", outdir],
                                lambda s_: self.status_label.setText(
                                    "Removing stars with StarXTerminator... %d s" % s_))
            exts = (".fit", ".fits", ".fts", ".tif", ".tiff", ".xisf", ".png")
            outs = [f for f in glob.glob(os.path.join(outdir, "*")) if f.lower().endswith(exts)]
            if not outs:     # in case --output was ignored
                outs = [f for f in glob.glob(os.path.join(tmp, "*"))
                        if f.lower().endswith(exts) and os.path.abspath(f) != os.path.abspath(inp)]
            if not outs:
                raise RuntimeError("StarXTerminator did not produce a starless image.\n" +
                                   "\n".join(lines[-10:]))
            # prefer the starless output if a stars image was written too
            outs.sort(key=lambda f: ("star" in os.path.basename(f).lower().replace("starless", ""), f))
            ff = self.siril.load_image_from_file(outs[0], with_pixels=True)
            if ff is None or ff.data is None:
                raise RuntimeError("Siril could not read StarXTerminator's output.")
            self.siril.log("StellarRadiance: StarXTerminator done.")
            return to_float(ff.data)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def load_starless_file(self):
        f = UI["starlessFile"]
        if not f:
            raise RuntimeError("Choose a starless image file first.")
        if not os.path.isfile(f):
            raise RuntimeError("Starless image file not found: %s" % f)
        ff = self.siril.load_image_from_file(f, with_pixels=True)
        if ff is None or ff.data is None:
            raise RuntimeError("Siril could not load %s" % f)
        return to_float(ff.data)

    def ensure_stars(self):
        if self.stars_ready():
            return
        self.stars_cache = None
        self.small.update(starless=None, stars=None, key=None)
        if UI["tool"] == TOOL_STARNET:
            starless = self.run_starnet()
        elif UI["tool"] == TOOL_SXT:
            starless = self.run_sxt()
        else:
            starless = self.load_starless_file()
        if starless.shape[1:] != self.orig.shape[1:]:
            raise RuntimeError("The starless image is %dx%d but this image is %dx%d."
                               % (starless.shape[2], starless.shape[1], self.W, self.H))
        if starless.shape[0] != self.C:
            starless = (np.repeat(starless, 3, axis=0) if self.C == 3
                        else luminance(starless)).astype(np.float32)
        stars = unscreen_stars(self.orig, starless)
        self.stars_cache = dict(key=self.removal_key(), starless=starless, stars=stars)

    def glow_layer(self):
        return self.stars_cache["starless"] if self.mode == MODE_OBJECT else self.stars_cache["stars"]

    def other_layer(self):
        return self.stars_cache["stars"] if self.mode == MODE_OBJECT else self.stars_cache["starless"]

    # ---- preview ---------------------------------------------------------
    def set_busy(self, b):
        self.busy = b
        for w in (self.apply_button, self.preview_button):
            w.setEnabled(not b)
        if b:
            QtWidgets.QApplication.setOverrideCursor(QtCore.Qt.CursorShape.WaitCursor)
        else:
            QtWidgets.QApplication.restoreOverrideCursor()
        self.preview.update()
        QtWidgets.QApplication.processEvents()

    def crop_rect(self):
        cw = min(max(1, self.preview.width()), self.W)
        ch = min(max(1, self.preview.height()), self.H)
        self.cx = max(cw / 2.0, min(self.W - cw / 2.0, self.cx))
        self.cy = max(ch / 2.0, min(self.H - ch / 2.0, self.cy))
        x0 = int(round(self.cx - cw / 2.0))
        y0 = int(round(self.cy - ch / 2.0))
        return x0, y0, cw, ch

    def update_preview(self, allow_removal=False):
        if self.busy:
            return
        self.timer.stop()
        full = UI["inputMode"] == 1
        need_removal = full and not self.stars_ready()
        t0 = time.time()

        if need_removal and not allow_removal:
            if self.region == 0:
                if self.small["orig"] is None:
                    self.small["orig"] = downsample(disp(self.orig))
                self.before_img = to_qimage(self.small["orig"])
            else:
                x0, y0, cw, ch = self.crop_rect()
                self.before_img = to_qimage(disp(self.orig)[:, y0:y0 + ch, x0:x0 + cw])
            self.after_img = self.before_img
            what = ["StarNet", "StarXTerminator", "the starless file"][UI["tool"]]
            self.status_label.setText("Showing original. Press Preview to separate the stars with %s "
                                      "and preview the glow." % what)
            self.preview.update()
            return

        self.set_busy(True)
        try:
            if need_removal:
                self.status_label.setText("Separating stars (one time, may take a while)...")
                QtWidgets.QApplication.processEvents()
                self.ensure_stars()

            if self.region == 0:
                if self.small["orig"] is None:
                    self.small["orig"] = downsample(disp(self.orig))
                small = self.small["orig"]
                if full and self.small["key"] != self.stars_cache["key"]:
                    self.small["starless"] = downsample(disp(self.stars_cache["starless"]))
                    self.small["stars"] = downsample(disp(self.stars_cache["stars"]))
                    self.small["key"] = self.stars_cache["key"]
                if full:
                    src = self.small["starless"] if self.mode == MODE_OBJECT else self.small["stars"]
                    other = self.small["stars"] if self.mode == MODE_OBJECT else self.small["starless"]
                else:
                    src, other = small, None
                res, _ = build_glow(src, self.G, self.mode, PREVIEW_DOWNSAMPLE)
                if other is not None:
                    res = screen(res, other)
                self.before_img = to_qimage(small)
                self.after_img = to_qimage(res)
                h, w = small.shape[1:]
                self.status_label.setText("Whole image at 1/%d resolution (%dx%d px, approximate)  -  %.2f s"
                                          % (PREVIEW_DOWNSAMPLE, w, h, time.time() - t0))
            else:
                x0, y0, cw, ch = self.crop_rect()
                # pad the crop so the blur near its edges matches the full image
                pad = int(math.ceil(3 * (effective_sigma(self.G) + selection_pad(self.G, self.mode)))) + 2
                px0, py0 = max(0, x0 - pad), max(0, y0 - pad)
                px1, py1 = min(self.W, x0 + cw + pad), min(self.H, y0 + ch + pad)
                srcfull = self.glow_layer() if full else self.orig
                src = np.ascontiguousarray(disp(srcfull)[:, py0:py1, px0:px1])
                res, _ = build_glow(src, self.G, self.mode, 1.0)
                if full:
                    res = screen(res, disp(self.other_layer())[:, py0:py1, px0:px1])
                ix, iy = x0 - px0, y0 - py0
                self.after_img = to_qimage(res[:, iy:iy + ch, ix:ix + cw])
                self.before_img = to_qimage(disp(self.orig)[:, y0:y0 + ch, x0:x0 + cw])
                self.status_label.setText("x=%d, y=%d (%dx%d px, 1:1)  -  %.2f s"
                                          % (x0, y0, cw, ch, time.time() - t0))
        except Exception as e:
            self.status_label.setText("Preview error: %s" % e)
            try:
                self.siril.log("StellarRadiance preview error: %s" % e)
            except Exception:
                pass
        finally:
            try:
                self.siril.reset_progress()
            except Exception:
                pass
            self.set_busy(False)

    # ---- final run -------------------------------------------------------
    def on_apply(self):
        self.timer.stop()
        self.resize_timer.stop()
        full = UI["inputMode"] == 1
        P = dict(self.G)
        P["passes"] = num_passes(P)
        t0 = time.time()
        self.set_busy(True)
        try:
            self.status_label.setText("Processing the full image...")
            QtWidgets.QApplication.processEvents()
            if full:
                self.ensure_stars()
            src = self.glow_layer() if full else self.orig
            self.siril.log("StellarRadiance: %s mode, %d passes" % (MODE_NAMES[self.mode], P["passes"]))
            try:
                self.siril.update_progress("StellarRadiance: building glow...", -1.0)
            except Exception:
                pass
            res, glow = build_glow(src, P, self.mode, 1.0, P["keepGlow"], log=self.siril.log)
            if full:
                res = screen(res, self.other_layer())
                self.siril.log("  stars screened back on top" if self.mode == MODE_OBJECT
                               else "  recombined with starless image")
            out = from_float(res, self.raw_dtype, self.raw_ndim)
            with self.siril.image_lock():
                self.siril.undo_save_state("StellarRadiance %s" % MODE_NAMES[self.mode])
                self.siril.set_image_pixeldata(out)
            if glow is not None:
                self.save_glow_layer(glow)
            save_settings(self.siril)
            self.siril.log("StellarRadiance done in %.2f s" % (time.time() - t0))
        except Exception as e:
            self.set_busy(False)
            self.status_label.setText("Error: %s" % e)
            try:
                self.siril.error_messagebox("StellarRadiance: %s" % e)
            except Exception:
                pass
            return
        finally:
            try:
                self.siril.reset_progress()
            except Exception:
                pass
        self.set_busy(False)
        self.close()

    def save_glow_layer(self, glow):
        base = os.path.splitext(os.path.basename(self.filename))[0] if self.filename else "image"
        folder = os.path.dirname(self.filename) if self.filename else os.getcwd()
        path = os.path.join(folder, base + "_glowlayer.fit")
        data = glow.astype(np.float32)
        if self.raw_ndim == 2:
            data = data[0]
        try:
            self.siril.save_image_file(np.ascontiguousarray(data), filename=path)
            self.siril.log("  glow layer saved: %s" % path)
        except Exception as e:
            self.siril.log("  could not save glow layer: %s" % e)


# ----------------------------------------------------------------------------
# Entry point
# ----------------------------------------------------------------------------
def main():
    if s is None:
        print("This script must be run from Siril (Scripts menu).")
        return
    siril = s.SirilInterface()
    try:
        siril.connect()
    except Exception as e:
        print("Could not connect to Siril: %s" % e)
        return
    try:
        siril.cmd("requires", "1.4.0")
    except Exception:
        siril.error_messagebox("StellarRadiance needs Siril 1.4.0 or later.")
        return
    if not siril.is_image_loaded():
        siril.error_messagebox("StellarRadiance: please load an image first.")
        return

    load_settings(siril)
    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication(sys.argv)
    win = StellarRadianceWindow(siril)
    win.resize(1200, 760)
    win.show()
    app.exec()


if __name__ == "__main__":
    main()
