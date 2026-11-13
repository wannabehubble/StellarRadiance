// ============================================================================
// StellarRadiance.js  -  PixInsight (PJSR) script  (formerly StarGlow)
// Copyright (c) 2026 Zachary Eichelberger. Released under the MIT License.
//
// Adds a natural-looking glow to a STARS-ONLY image using iterative
// (cascaded) Gaussian blur passes. Each pass blurs the previous result a
// little more, and every pass is added to a glow layer with a decaying
// weight. Tight inner halos come out strong and wide outer halos come out
// faint, which is roughly how light scatters in optics and atmosphere.
// The glow is then blended back onto the original stars.
//
// v1.1: live preview. A 1:1 crop of the image is processed with the exact
//       same algorithm as the final run (with padding, so edges are correct).
//       Drag the preview to pan; tick "Show original" to compare.
// v1.2: sharper threshold (up to 0.98), star size filter to reject small
//       stars, glow strength up to 10.
// v1.3: core reduction (attenuates the first, tightest passes while outer
//       passes stay at full strength) and a smoother highlight rolloff.
// v1.4: remembers your last settings (saved when you click OK) and adds a
//       Reset button to restore the defaults.
// v1.5: removed core reduction (superseded by Smooth rolloff); added
//       Light / Moderate / Intense presets.
// v1.6: full-image mode: removes stars with StarNet2 or StarXTerminator,
//       glows the stars-only image and screens it back onto the starless one.
// v1.7: the dialog preview can follow a PixInsight preview box drawn on the
//       image (Preview region menu). Large regions are scaled to fit.
// v1.8: glow saturation slider (affects the glow only); first pass sigma and
//       sigma growth factor moved under "Show advanced settings".
// v1.9: weight decay, threshold and star size filter also moved under
//       advanced settings; SCNR option to reduce green in the stars + glow.
// v1.10: removed the "Keep starless and stars-only images" and SCNR
//        checkboxes; SCNR is now controlled by its amount slider alone
//        (0 = off).
// v1.11: glow strength goes up to 30; new "Extreme" preset (strength 30).
// v2.0: "Glow target" switch. Stars mode works as before. Objects mode adds
//       a soft bloom to the STARLESS image (nebulae, galaxies) with its own
//       parameter set, presets (small / large scale) and saved settings.
//       In full-image mode the stars are screened back on top, unglowed.
// v2.1: Objects presets re-based on user-tuned values; Highlight protection
//       (lightness mask that holds the glow back from bright areas) and
//       Mask feather sliders, in both modes.
// v2.2: Stars presets (Light / Moderate / Intense / Extreme) replaced with
//       user-tuned values.
// v2.3: Objects presets replaced with Natural - Light / Moderate / Intense.
//       Star removal no longer runs automatically when the dialog opens (or
//       on live updates); press Refresh to run it for the preview. OK always
//       runs it when needed.
// v2.4: renamed from StarGlow to StellarRadiance.
// v2.5: modes renamed Stellar / Non-Stellar; blend mode option removed (the
//       glow is always screened on); wider preset menu.
// v2.6: Refresh button renamed Preview; help box says to press it to start.
// v2.7: "Whole image" preview region (the default): the full frame is
//       downsampled to 1/3 resolution and processed with the pixel-based
//       settings scaled to match, then shown fitted to the preview box.
// v2.8: "Image" menu to pick any open image as the source; advanced settings
//       always start hidden.
// v2.9: Input options renamed (Stars-only / Starless / Combined); the preview
//       grows with the dialog window.
// v2.9.1: author credit and a tidier info box.
// v2.9.2: images with an alpha (transparency) channel, e.g. many PNGs, no
//         longer give a blank preview or result; the alpha channel is ignored.
//
// Use on a NON-LINEAR (stretched) image: a stars-only image (Stellar mode), a
// starless image (Non-Stellar mode), or a combined image with stars (either mode).
// The result is written to a NEW image, so your original is never touched.
// ============================================================================

#feature-id    Utilities > StellarRadiance
#feature-info  Adds a realistic glow to stars, or a soft bloom to nebulae and galaxies, using iterative Gaussian blur passes.

#include <pjsr/Sizer.jsh>
#include <pjsr/NumericControl.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/UndoFlag.jsh>
#include <pjsr/FrameStyle.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/DataType.jsh>

#define TITLE   "StellarRadiance"
#define VERSION "2.9.2"
#define AUTHOR  "Zachary Eichelberger"
#define SETTINGS_KEY "StarGlow"   // kept from the old name so saved settings carry over

// ----------------------------------------------------------------------------
// Parameter sets. Each glow target (mode) has its own defaults, presets and
// saved settings. G always points at the parameters of the active mode.
//
//   passes     number of blur passes
//   baseSigma  sigma (px) of the first pass
//   growth     each pass's sigma = previous sigma * growth
//   decay      weight of pass k = decay^k (normalized)
//   strength   overall glow intensity
//   threshold  Stars: hard brightness cutoff for which stars glow
//              Objects: only brightness ABOVE this level blooms
//   starSize   small-star rejection (px), Stars mode only; 0 = off
//   rolloff    0 = none (hard clip), 1 = exponential, 2 = smooth
//   glowSat    glow saturation: 0 = white glow, 1 = natural, >1 = more colour
//   scnrAmount SCNR green removal on stars + glow, Stars mode only; 0 = off
//   hlProtect  highlight protection: 0 = off .. 1 = no glow on pure white
//   hlFeather  blur (px) applied to the highlight-protection mask
//   keepGlow   leave the glow layer open as its own image
// ----------------------------------------------------------------------------
var MODE_STARS  = 0;
var MODE_OBJECT = 1;
var MODE_NAMES  = [ "Stellar", "Non-Stellar" ];

var MODES = [
   {  // ---------------- Stars ----------------
      prefix    : SETTINGS_KEY + "/",          // same keys as v1.x, so old settings carry over
      outSuffix : "_glow",
      defaults  : { passes: 6, baseSigma: 1.5, growth: 1.6, decay: 0.70, strength: 0.60,
                    threshold: 0.05, starSize: 0.0, rolloff: 2,
                    glowSat: 1.0, scnrAmount: 0.0, hlProtect: 0.0, hlFeather: 5.0,
                    keepGlow: false },
      presets   : [
         { name: "Light",    values: { passes:  6, baseSigma: 12.0, growth: 3.0, decay: 1.0, strength:  2.0,
                                       threshold: 0.375, starSize: 7.0, glowSat: 1.0,
                                       rolloff: 2 } },
         { name: "Moderate", values: { passes:  6, baseSigma: 12.0, growth: 3.0, decay: 1.0, strength:  8.0,
                                       threshold: 0.375, starSize: 7.0, glowSat: 1.0,
                                       rolloff: 2 } },
         { name: "Intense",  values: { passes:  6, baseSigma: 12.0, growth: 3.0, decay: 1.0, strength: 16.0,
                                       threshold: 0.375, starSize: 7.0, glowSat: 1.0,
                                       rolloff: 2 } },
         { name: "Extreme",  values: { passes: 12, baseSigma:  6.0, growth: 1.5, decay: 1.0, strength: 30.0,
                                       threshold: 0.375, starSize: 7.0, glowSat: 1.0,
                                       rolloff: 2 } }
      ]
   },
   {  // ---------------- Objects (starless) ----------------
      prefix    : SETTINGS_KEY + "/object/",
      outSuffix : "_objglow",
      // Defaults = the "Natural - Light" preset.
      defaults  : { passes: 6, baseSigma: 15.0, growth: 3.0, decay: 0.75, strength: 0.30,
                    threshold: 0.065, starSize: 0.0, rolloff: 2,
                    glowSat: 1.0, scnrAmount: 0.0, hlProtect: 0.50, hlFeather: 25.0,
                    keepGlow: false },
      // User-tuned "Natural" presets. Moderate and Intense add +0.30 and
      // +0.60 glow strength to Light; everything else is identical.
      presets   : [
         { name: "Natural - Light",    values: { passes: 6, baseSigma: 15.0, growth: 3.0, decay: 0.75,
                                                 strength: 0.30, threshold: 0.065, glowSat: 1.0,
                                                 hlProtect: 0.50, hlFeather: 25.0,
                                                 rolloff: 2 } },
         { name: "Natural - Moderate", values: { passes: 6, baseSigma: 15.0, growth: 3.0, decay: 0.75,
                                                 strength: 0.60, threshold: 0.065, glowSat: 1.0,
                                                 hlProtect: 0.50, hlFeather: 25.0,
                                                 rolloff: 2 } },
         { name: "Natural - Intense",  values: { passes: 6, baseSigma: 15.0, growth: 3.0, decay: 0.75,
                                                 strength: 0.90, threshold: 0.065, glowSat: 1.0,
                                                 hlProtect: 0.50, hlFeather: 25.0,
                                                 rolloff: 2 } }
      ]
   }
];

function copyOf( o )
{
   var c = {};
   for ( var k in o )
      c[k] = o[k];
   return c;
}

for ( var m = 0; m < MODES.length; ++m )
   MODES[m].params = copyOf( MODES[m].defaults );

var G = MODES[MODE_STARS].params;   // active parameter set

function currentMode()    { return MODES[UI.mode]; }
function isObjectMode()   { return UI.mode == MODE_OBJECT; }

function setMode( mode )
{
   UI.mode = mode;
   G = MODES[mode].params;
}

// Index into the active mode's presets of the one matching G, or -1.
function matchingPreset()
{
   var presets = currentMode().presets;
   for ( var i = 0; i < presets.length; ++i )
   {
      var v = presets[i].values, ok = true;
      for ( var key in v )
         if ( Math.abs( G[key] - v[key] ) > 1e-3 )
         {
            ok = false;
            break;
         }
      if ( ok )
         return i;
   }
   return -1;
}

var ROLLOFF_NAMES = [ "None (hard clip)", "Exponential", "Smooth (long shoulder)" ];
var PREVIEW_SIZES = [ 400, 600, 800 ];
var PREVIEW_DOWNSAMPLE = 3;   // "Whole image" preview runs at 1/PREVIEW_DOWNSAMPLE resolution

// ----------------------------------------------------------------------------
// Persistent settings (stored in PixInsight's own settings, per user)
// ----------------------------------------------------------------------------
var UI = {
   mode             : 0,      // glow target: 0 = stars, 1 = objects (starless)
   previewSizeIndex : 0,
   liveUpdate       : true,
   inputMode        : 0,      // 0 = stars-only / starless image, 1 = full image (remove stars first)
   tool             : 0,      // 0 = StarNet2, 1 = StarXTerminator
   showAdvanced     : false   // show sigma, growth, decay, threshold, star size
};

var INPUT_NAMES = [ "Stars-only", "Combined" ];
var INPUT_NAME0 = [ "Stars-only", "Starless" ];   // item 0 label per mode (Stellar / Non-Stellar)
var TOOL_NAMES  = [ "StarNet2", "StarXTerminator" ];

function settingType( v )
{
   return ( typeof v == "boolean" ) ? DataType_Boolean : DataType_Double;
}

function loadSettings()
{
   for ( var m = 0; m < MODES.length; ++m )
   {
      var M = MODES[m];
      for ( var key in M.defaults )
      {
         var v = Settings.read( M.prefix + key, settingType( M.defaults[key] ) );
         if ( Settings.lastReadOK && v != null )
            M.params[key] = v;
      }
      // sanitize list indices in case of stale / odd stored values
      M.params.rolloff   = Math.max( 0, Math.min( ROLLOFF_NAMES.length - 1, Math.round( M.params.rolloff ) ) );
   }
   var md = Settings.read( SETTINGS_KEY + "/mode", DataType_Int32 );
   if ( Settings.lastReadOK && md != null )
      UI.mode = Math.max( 0, Math.min( MODES.length - 1, md ) );
   var idx = Settings.read( SETTINGS_KEY + "/previewSizeIndex", DataType_Int32 );
   if ( Settings.lastReadOK && idx != null )
      UI.previewSizeIndex = Math.max( 0, Math.min( PREVIEW_SIZES.length - 1, idx ) );
   var live = Settings.read( SETTINGS_KEY + "/liveUpdate", DataType_Boolean );
   if ( Settings.lastReadOK && live != null )
      UI.liveUpdate = live;
   var mode = Settings.read( SETTINGS_KEY + "/inputMode", DataType_Int32 );
   if ( Settings.lastReadOK && mode != null )
      UI.inputMode = Math.max( 0, Math.min( INPUT_NAMES.length - 1, mode ) );
   var tool = Settings.read( SETTINGS_KEY + "/tool", DataType_Int32 );
   if ( Settings.lastReadOK && tool != null )
      UI.tool = Math.max( 0, Math.min( TOOL_NAMES.length - 1, tool ) );
   // Advanced settings always start hidden (not restored) to keep the
   // dialog uncluttered.

   // v1.9 had a separate SCNR on/off checkbox. If it was saved as off,
   // start with SCNR off (amount 0), then drop the old key.
   var oldScnr = Settings.read( SETTINGS_KEY + "/scnr", DataType_Boolean );
   if ( Settings.lastReadOK && oldScnr != null )
   {
      if ( !oldScnr )
         MODES[MODE_STARS].params.scnrAmount = 0;
      Settings.remove( SETTINGS_KEY + "/scnr" );
   }

   setMode( UI.mode );
}

function saveSettings()
{
   for ( var m = 0; m < MODES.length; ++m )
   {
      var M = MODES[m];
      for ( var key in M.defaults )
         Settings.write( M.prefix + key, settingType( M.defaults[key] ), M.params[key] );
   }
   Settings.write( SETTINGS_KEY + "/mode", DataType_Int32, UI.mode );
   Settings.write( SETTINGS_KEY + "/previewSizeIndex", DataType_Int32, UI.previewSizeIndex );
   Settings.write( SETTINGS_KEY + "/liveUpdate", DataType_Boolean, UI.liveUpdate );
   Settings.write( SETTINGS_KEY + "/inputMode", DataType_Int32, UI.inputMode );
   Settings.write( SETTINGS_KEY + "/tool", DataType_Int32, UI.tool );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function numPasses()
{
   return Math.max( 1, Math.round( G.passes ) );
}

// Effective sigma of the whole cascade = sqrt(sum of sigma_i^2)
function effectiveSigma()
{
   var s = G.baseSigma, v = 0;
   for ( var k = 0, n = numPasses(); k < n; ++k )
   {
      var c = Math.min( s, 250 );
      v += c*c;
      s *= G.growth;
   }
   return Math.sqrt( v );
}

// Colour channels only (3 for RGB, 1 for mono). Alpha (transparency)
// channels, common in PNG and TIFF files, are left out: processing them
// would make the glow layer transparent and the preview look blank.
function nominalChannels( img )
{
   return img.isColor ? 3 : 1;
}

// Copy of the colour channels of srcImage (optionally a rectangle of it).
function copyNominal( dstImage, srcImage, rect )
{
   var r = ( rect != undefined ) ? rect : new Rect( 0, 0, srcImage.width, srcImage.height );
   dstImage.assign( srcImage, r, 0, nominalChannels( srcImage ) - 1 );
}

// Create a hidden 32-bit float window that is a copy of srcImage
// (colour channels only, never alpha).
function makeWindowLike( srcImage, id )
{
   var w = new ImageWindow( srcImage.width, srcImage.height,
                            nominalChannels( srcImage ),
                            32, true, srcImage.isColor, id );
   w.mainView.beginProcess( UndoFlag_NoSwapFile );
   copyNominal( w.mainView.image, srcImage );
   w.mainView.endProcess();
   return w;
}

function runPixelMath( view, expr, noTruncate )
{
   var P = new PixelMath;
   P.expression = expr;
   P.useSingleExpression = true;   // same expression on every channel
   P.createNewImage = false;
   P.rescale = false;
   P.truncate = !noTruncate;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.executeOn( view, false );
}

// PixelMath with a separate expression per RGB channel.
function runPixelMathRGB( view, exprR, exprG, exprB )
{
   var P = new PixelMath;
   P.useSingleExpression = false;
   P.expression  = exprR;
   P.expression1 = exprG;
   P.expression2 = exprB;
   P.createNewImage = false;
   P.rescale = false;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.executeOn( view, false );
}

// SCNR (green removal), average neutral protection, lightness preserved.
function applySCNR( view, amount )
{
   var P = new SCNR;
   P.amount            = amount;
   P.protectionMethod  = SCNR.prototype.AverageNeutral;
   P.colorToRemove     = SCNR.prototype.Green;
   P.preserveLightness = true;
   P.executeOn( view, false );
}

function gaussianBlur( view, sigma )
{
   var P = new Convolution;
   P.mode = Convolution.prototype.Parametric;
   P.sigma = Math.max( 0.1, sigma );   // scaled-down preview sigmas can get very small
   P.shape = 2.0;          // 2 = true Gaussian profile
   P.aspectRatio = 1.0;
   P.rotationAngle = 0.0;
   P.executeOn( view, false );
}

// ----------------------------------------------------------------------------
// Star removal (full-image mode)
//
// The removal tool is only used to produce the STARLESS image. The stars-only
// image is then computed with an "unscreen" in PixelMath:
//
//    stars = 1 - (1 - original) / (1 - starless)
//
// so that screening the stars back onto the starless image reproduces the
// original exactly (before any glow is added). This works the same way for
// both tools and doesn't depend on how each tool names its extra outputs.
//
// The result is cached for the life of the dialog, so star removal runs only
// once (or again when you switch tools).
// ----------------------------------------------------------------------------
var STARS_CACHE = null;   // { tool, starless: ImageWindow, stars: ImageWindow }

function releaseStarsCache()
{
   if ( STARS_CACHE != null )
   {
      if ( STARS_CACHE.starless != null ) STARS_CACHE.starless.forceClose();
      if ( STARS_CACHE.stars    != null ) STARS_CACHE.stars.forceClose();
      STARS_CACHE = null;
   }
   releaseSmallLayers();
}

// ----------------------------------------------------------------------------
// Downsampled copies for the "Whole image" preview. The original is reduced
// once per dialog; in full-image mode the starless / stars layers are reduced
// from the full-resolution STARS_CACHE (so star removal itself always runs at
// full resolution, exactly like the final run).
// ----------------------------------------------------------------------------
var SMALL_CACHE = { orig: null, starless: null, stars: null, tool: -1 };

function downsampleWindow( srcImage, id )
{
   var w = makeWindowLike( srcImage, id );
   var P = new IntegerResample;
   P.zoomFactor = -PREVIEW_DOWNSAMPLE;                        // negative = reduce
   P.downsamplingMode = IntegerResample.prototype.Average;
   P.executeOn( w.mainView, false );
   return w;
}

function releaseSmallLayers()
{
   if ( SMALL_CACHE.starless != null ) SMALL_CACHE.starless.forceClose();
   if ( SMALL_CACHE.stars    != null ) SMALL_CACHE.stars.forceClose();
   SMALL_CACHE.starless = SMALL_CACHE.stars = null;
   SMALL_CACHE.tool = -1;
}

function releaseSmallCache()
{
   releaseSmallLayers();
   if ( SMALL_CACHE.orig != null ) SMALL_CACHE.orig.forceClose();
   SMALL_CACHE.orig = null;
}

function smallOriginal( srcImage )
{
   if ( SMALL_CACHE.orig == null )
      SMALL_CACHE.orig = downsampleWindow( srcImage, "StellarRadiance_small" );
   return SMALL_CACHE.orig;
}

// Requires STARS_CACHE (full-image mode).
function ensureSmallLayers()
{
   if ( SMALL_CACHE.tool == STARS_CACHE.tool && SMALL_CACHE.starless != null )
      return;
   releaseSmallLayers();
   SMALL_CACHE.starless = downsampleWindow( STARS_CACHE.starless.mainView.image, "StellarRadiance_smallSL" );
   SMALL_CACHE.stars    = downsampleWindow( STARS_CACHE.stars.mainView.image,    "StellarRadiance_smallST" );
   SMALL_CACHE.tool     = STARS_CACHE.tool;
}

function smallGlowLayer()  { return isObjectMode() ? SMALL_CACHE.starless : SMALL_CACHE.stars; }
function smallOtherLayer() { return isObjectMode() ? SMALL_CACHE.stars    : SMALL_CACHE.starless; }

function windowIdSet()
{
   var set = {};
   var ws = ImageWindow.windows;
   for ( var i = 0; i < ws.length; ++i )
      set[ws[i].mainView.id] = true;
   return set;
}

function extractStars( srcImage, baseId, tool )
{
   var starless = null, stars = null;
   try
   {
      var existing = windowIdSet();

      starless = makeWindowLike( srcImage, baseId + "_starless" );
      var P;
      if ( tool == 0 )
      {
         if ( typeof StarNet2 == "undefined" )
            throw new Error( "StarNet2 is not installed in this PixInsight." );
         P = new StarNet2;
         P.mask   = false;   // we compute the stars image ourselves
         P.linear = false;   // input is stretched
      }
      else
      {
         if ( typeof StarXTerminator == "undefined" )
            throw new Error( "StarXTerminator is not installed in this PixInsight." );
         P = new StarXTerminator;
         P.stars    = false; // we compute the stars image ourselves
         P.unscreen = false;
      }

      console.writeln( "<end><cbr><b>" + TITLE + "</b>: removing stars with " + TOOL_NAMES[tool] + "..." );
      processEvents();
      if ( !P.executeOn( starless.mainView, false ) )
         throw new Error( TOOL_NAMES[tool] + " failed." );

      // Close any extra windows the tool may have opened.
      var ws = ImageWindow.windows;
      for ( var i = 0; i < ws.length; ++i )
      {
         var id = ws[i].mainView.id;
         if ( !existing[id] && id != starless.mainView.id )
            ws[i].forceClose();
      }

      stars = makeWindowLike( srcImage, baseId + "_stars" );
      runPixelMath( stars.mainView,
         "1 - (1 - $T) / max(0.000001, 1 - " + starless.mainView.id + ")" );

      var out = { tool: tool, starless: starless, stars: stars };
      starless = stars = null;
      return out;
   }
   finally
   {
      if ( starless != null ) starless.forceClose();
      if ( stars    != null ) stars.forceClose();
   }
}

// Make sure STARS_CACHE holds the current tool's result for srcWindow.
function ensureStars( srcWindow )
{
   if ( STARS_CACHE != null && STARS_CACHE.tool == UI.tool )
      return;
   releaseStarsCache();
   STARS_CACHE = extractStars( srcWindow.mainView.image, srcWindow.mainView.id, UI.tool );
}

// Screen the other layer (starless in Stars mode, stars in Objects mode)
// together with the glowed layer in 'view'. Screen is symmetric.
function recombine( view, otherId )
{
   runPixelMath( view, "1 - (1 - $T)*(1 - " + otherId + ")" );
}

// In full-image mode: the layer that gets the glow, and the one that is
// screened back on unchanged.
function glowLayer()  { return isObjectMode() ? STARS_CACHE.starless : STARS_CACHE.stars; }
function otherLayer() { return isObjectMode() ? STARS_CACHE.stars    : STARS_CACHE.starless; }

// Extra crop padding needed by the pre-blurs: star-size filter (Stars mode
// only) and the highlight-protection mask feather.
function selectionPad()
{
   var p = isObjectMode() ? 0 : G.starSize;
   if ( G.hlProtect > 0 )
      p = Math.max( p, G.hlFeather );
   return p;
}

// ----------------------------------------------------------------------------
// Core algorithm (shared by the preview and the final run)
//
// Returns { result: ImageWindow, glow: ImageWindow|null }, both hidden.
// The caller owns the returned windows and must show or close them.
// ----------------------------------------------------------------------------
// scale: > 1 when srcImage is a downsampled copy (Whole image preview). All
// pixel-based settings (sigmas, star size, mask feather) are divided by it so
// the glow keeps the same size relative to the frame.
function buildGlow( srcImage, resultId, glowId, wantGlow, verbose, scale )
{
   var base = null, accum = null, result = null;
   var sc = ( scale != undefined && scale > 0 ) ? scale : 1;

   try
   {
      // PixInsight may rename windows if the ids are taken, so always read
      // the real id back before using it in PixelMath.
      base  = makeWindowLike( srcImage, "StellarRadiance_tmp" );
      accum = makeWindowLike( srcImage, glowId );

      accum.mainView.beginProcess( UndoFlag_NoSwapFile );
      accum.mainView.image.fill( 0 );
      accum.mainView.endProcess();

      var baseId  = base.mainView.id;
      var accumId = accum.mainView.id;

      // 1a) Objects mode: classic bloom source. Only the part of the signal
      //     above the threshold feeds the glow, so faint background stays
      //     dark while bright structures bloom into their surroundings.
      if ( isObjectMode() )
      {
         if ( G.threshold > 0 )
         {
            var to = G.threshold.toFixed( 4 );
            runPixelMath( base.mainView, "max(0, ($T - " + to + ") / (1 - " + to + "))" );
         }
      }
      // 1b) Stars mode: star selection: threshold + optional small-star rejection.
      //    A selection copy is (optionally) blurred by the star-size sigma.
      //    Small stars get diluted below the threshold by that blur, big
      //    bright stars survive. The selection becomes a hard-edged mask,
      //    and only masked stars (at full brightness) feed the glow.
      else if ( G.threshold > 0 || G.starSize > 0 )
      {
         var sel = makeWindowLike( srcImage, "StellarRadiance_sel" );
         try
         {
            if ( G.starSize > 0 )
               gaussianBlur( sel.mainView, G.starSize/sc );
            var selId = sel.mainView.id;
            var t = G.threshold.toFixed( 4 );
            // narrow transition band just above the threshold = aggressive cut
            var bw = Math.max( 0.01, (1 - G.threshold)*0.25 ).toFixed( 4 );
            runPixelMath( base.mainView,
               "$T * min(1, max(0, (" + selId + " - " + t + ") / " + bw + "))" );
         }
         finally
         {
            sel.forceClose();
         }
      }

      // 2) Decaying, normalized weights
      var n = numPasses();
      var weights = [], wsum = 0;
      for ( var k = 0; k < n; ++k )
      {
         var wk = Math.pow( G.decay, k );
         weights.push( wk );
         wsum += wk;
      }

      // 3) Iterative cascade
      var sigma = G.baseSigma, effVar = 0;
      if ( verbose )
         console.writeln( "<end><cbr><b>" + TITLE + "</b>: " + n + " passes" );

      for ( var k = 0; k < n; ++k )
      {
         var s = Math.min( sigma, 250 );
         gaussianBlur( base.mainView, s/sc );
         effVar += s*s;

         var w = G.strength * weights[k] / wsum;
         runPixelMath( accum.mainView, "$T + " + w.toFixed( 6 ) + "*" + baseId, true );

         if ( verbose )
         {
            console.writeln( format( "  pass %d: sigma %.2f px, effective sigma %.2f px, weight %.4f",
                                     k+1, s, Math.sqrt( effVar ), w ) );
            processEvents();
         }
         sigma *= G.growth;
      }

      // 4) Highlight rolloff of the glow layer.
      //    Exponential: 1 - exp(-x)  (reaches ~white quickly)
      //    Smooth:      x / (1 + x)  (much longer shoulder, gentler falloff)
      //    The accumulation above is NOT truncated at 1, so the rolloff sees
      //    the true glow values instead of an already-clipped plateau.
      if ( G.rolloff == 1 )
         runPixelMath( accum.mainView, "1 - exp(-$T)" );
      else if ( G.rolloff == 2 )
         runPixelMath( accum.mainView, "$T / (1 + $T)" );

      // 5) Glow saturation (colour images only). Each channel is pushed away
      //    from (or pulled toward) the glow's own luminance:
      //       c' = L + (c - L) * saturation
      //    Only the glow layer is changed; the stars themselves are untouched.
      if ( srcImage.isColor && Math.abs( G.glowSat - 1 ) > 1e-3 )
      {
         var L  = "(0.2126*$T[0] + 0.7152*$T[1] + 0.0722*$T[2])";
         var sf = G.glowSat.toFixed( 4 );
         runPixelMathRGB( accum.mainView,
                          L + " + ($T[0] - " + L + ")*" + sf,
                          L + " + ($T[1] - " + L + ")*" + sf,
                          L + " + ($T[2] - " + L + ")*" + sf );
      }

      // 5b) Highlight protection. A lightness mask of the layer being glowed
      //     (optionally feathered) scales the glow down where the image is
      //     already bright:  glow' = glow * (1 - protection * mask)
      //     so intense glow can't wash out cores and bright structures.
      if ( G.hlProtect > 0 )
      {
         var mask = makeWindowLike( srcImage, "StellarRadiance_hlmask" );
         try
         {
            if ( srcImage.isColor )
            {
               var Lm = "(0.2126*$T[0] + 0.7152*$T[1] + 0.0722*$T[2])";
               runPixelMathRGB( mask.mainView, Lm, Lm, Lm );
            }
            if ( G.hlFeather > 0 )
               gaussianBlur( mask.mainView, G.hlFeather/sc );
            runPixelMath( accum.mainView,
               "$T * (1 - " + G.hlProtect.toFixed( 4 ) + "*" + mask.mainView.id + ")", true );
         }
         finally
         {
            mask.forceClose();
         }
      }

      // 6) Screen the glow onto the layer:  1 - (1 - layer)*(1 - glow)
      result = makeWindowLike( srcImage, resultId );
      runPixelMath( result.mainView, "1 - (1 - $T)*(1 - " + accumId + ")" );

      // 7) SCNR on the stars + glow only. In full-image mode this happens
      //    before recombination, so the starless background is untouched.
      if ( !isObjectMode() && srcImage.isColor && G.scnrAmount > 0 )
         applySCNR( result.mainView, G.scnrAmount );

      var out = { result: result, glow: null };
      result = null;              // ownership passes to the caller
      if ( wantGlow )
      {
         out.glow = accum;
         accum = null;
      }
      return out;
   }
   finally
   {
      if ( base   != null ) base.forceClose();
      if ( accum  != null ) accum.forceClose();
      if ( result != null ) result.forceClose();   // only on error
   }
}

// Final, full-resolution run
function applyStellarRadiance( srcWindow )
{
   var srcView = srcWindow.mainView;
   var full = ( UI.inputMode == 1 );

   if ( full )
      ensureStars( srcWindow );

   var glowImage = full ? glowLayer().mainView.image : srcView.image;
   var out = buildGlow( glowImage, srcView.id + currentMode().outSuffix, "StellarRadiance_glow", G.keepGlow, true );

   if ( full )
   {
      recombine( out.result.mainView, otherLayer().mainView.id );
      console.writeln( isObjectMode() ? "  stars screened back on top"
                                      : "  recombined with starless image" );
      releaseStarsCache();
   }

   out.result.keywords = srcWindow.keywords;
   out.result.show();
   out.result.zoomToOptimalFit();
   console.writeln( "  output: " + out.result.mainView.id );

   if ( out.glow != null )
   {
      out.glow.show();
      out.glow.zoomToOptimalFit();
   }
}

// ----------------------------------------------------------------------------
// Dialog
// ----------------------------------------------------------------------------
function StellarRadianceDialog( srcWindow )
{
   this.__base__ = Dialog;
   this.__base__();

   var self = this;

   this.srcWindow   = srcWindow;
   this.srcImage    = srcWindow.mainView.image;
   this.previewSize = PREVIEW_SIZES[UI.previewSizeIndex];
   this.numerics    = {};                        // key -> NumericControl
   this.cx          = this.srcImage.width  / 2;   // preview centre (image px)
   this.cy          = this.srcImage.height / 2;
   this.beforeBmp   = null;   // bitmaps as displayed (scaled to fit)
   this.afterBmp    = null;
   this.rawBefore   = null;   // unscaled originals, kept so a window resize
   this.rawAfter    = null;   // can refit them without reprocessing
   this.rawW        = 0;
   this.rawH        = 0;
   this.dragging    = false;
   this.dragDX      = 0;
   this.dragDY      = 0;
   this.busy        = false;
   this.piPreviews  = srcWindow.previews;          // PixInsight preview boxes on the image
   // Region menu: 0 = whole image (1/3 res), 1 = free 1:1 crop,
   //              i >= 2 = PixInsight preview box piPreviews[i-2]
   this.regionIndex = 0;

   // If the script was launched with a preview box selected, start on it.
   var cv = srcWindow.currentView;
   if ( cv != null && !cv.isNull && cv.isPreview )
      for ( var i = 0; i < this.piPreviews.length; ++i )
         if ( this.piPreviews[i].id == cv.id )
            this.regionIndex = i + 2;

   var labelWidth = this.font.width( "Highlight protection:" ) + 12;

   // ---- Debounced live update -------------------------------------------
   this.timer = new Timer;
   this.timer.interval = 0.35;   // seconds
   this.timer.periodic = false;
   this.timer.onTimeout = function() { self.updatePreview(); };

   this.schedulePreview = function()
   {
      if ( !self.liveCheck.checked )
         return;
      self.timer.stop();
      self.timer.start();
   };

   // Push the current G values into every control.
   this.syncing = false;   // guards against re-entrant control events
   this.syncControls = function()
   {
      self.syncing = true;
      for ( var key in self.numerics )
         self.numerics[key].setValue( G[key] );
      self.rolloffCombo.currentItem = G.rolloff;
      self.keepGlowCheck.checked    = G.keepGlow;
      self.syncing = false;
      self.updatePresetCombo();
   };

   // Fill the preset menu with the active mode's presets.
   this.rebuildPresetCombo = function()
   {
      self.syncing = true;
      self.presetCombo.clear();
      self.presetCombo.addItem( "Custom" );
      var presets = currentMode().presets;
      for ( var i = 0; i < presets.length; ++i )
         self.presetCombo.addItem( presets[i].name );
      self.syncing = false;
   };

   // Everything that differs between Stars and Objects mode.
   this.applyModeToControls = function()
   {
      self.inputCombo.setItemText( 0, INPUT_NAME0[UI.mode] );
      self.rebuildPresetCombo();
      self.syncControls();
      self.updateAdvancedControls();
      self.helpLabel.text = self.helpText();
      self.adjustToContents();
   };

   // ---- Source image ----------------------------------------------------
   // Every visible image window open in PixInsight.
   this.imageWindows = [];
   var allWins = ImageWindow.windows;
   for ( var i = 0; i < allWins.length; ++i )
      if ( !allWins[i].isNull && allWins[i].visible )
         this.imageWindows.push( allWins[i] );

   this.imageLabel = new Label( this );
   this.imageLabel.text = "Image:";
   this.imageLabel.minWidth = labelWidth;
   this.imageLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;

   this.imageCombo = new ComboBox( this );
   for ( var i = 0; i < this.imageWindows.length; ++i )
   {
      this.imageCombo.addItem( this.imageWindows[i].mainView.id );
      if ( this.imageWindows[i].mainView.id == srcWindow.mainView.id )
         this.imageCombo.currentItem = i;
   }
   this.imageCombo.toolTip = "Image to process. Lists every image open in PixInsight.";
   this.imageCombo.onItemSelected = function( index )
   {
      var w = self.imageWindows[index];
      if ( w.mainView.id == self.srcWindow.mainView.id )
         return;
      self.setSourceWindow( w );
   };

   this.imageSizer = new HorizontalSizer;
   this.imageSizer.spacing = 4;
   this.imageSizer.add( this.imageLabel );
   this.imageSizer.add( this.imageCombo, 100 );

   // Switch the source image: drop cached star removal and preview data,
   // reset the preview region and refresh.
   this.setSourceWindow = function( w )
   {
      self.timer.stop();
      releaseStarsCache();
      releaseSmallCache();
      self.srcWindow   = w;
      self.srcImage    = w.mainView.image;
      self.piPreviews  = w.previews;
      self.cx          = self.srcImage.width  / 2;
      self.cy          = self.srcImage.height / 2;
      self.regionIndex = 0;
      self.beforeBmp   = self.afterBmp = null;
      self.rawBefore   = self.rawAfter = null;
      self.rebuildRegionCombo();
      self.updateRegionControls();
      self.glowSatControl.enabled    = self.srcImage.isColor;
      self.scnrAmountControl.enabled = self.srcImage.isColor;
      self.updatePreview();
   };

   // ---- Glow target (mode) ----------------------------------------------
   this.modeLabel = new Label( this );
   this.modeLabel.text = "Glow target:";
   this.modeLabel.minWidth = labelWidth;
   this.modeLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;

   this.modeCombo = new ComboBox( this );
   for ( var i = 0; i < MODE_NAMES.length; ++i )
      this.modeCombo.addItem( MODE_NAMES[i] );
   this.modeCombo.currentItem = UI.mode;
   this.modeCombo.toolTip = "Stellar: glow around stars (stars-only image, or the stars of a combined image).\n" +
      "Non-Stellar: soft bloom on nebulae / galaxies (starless image, or the starless part of a " +
      "combined image; stars are added back unglowed).\nEach target keeps its own settings and presets.";
   this.modeCombo.onItemSelected = function( index )
   {
      if ( index == UI.mode )
         return;
      setMode( index );
      self.applyModeToControls();
      self.schedulePreview();
   };

   this.modeSizer = new HorizontalSizer;
   this.modeSizer.spacing = 4;
   this.modeSizer.add( this.modeLabel );
   this.modeSizer.add( this.modeCombo );
   this.modeSizer.addStretch();

   // Show the matching preset name, or "Custom" if settings were changed.
   this.updatePresetCombo = function()
   {
      if ( self.syncing )
         return;
      self.syncing = true;
      self.presetCombo.currentItem = matchingPreset() + 1;   // item 0 = Custom
      self.syncing = false;
   };

   // ---- Input / star removal --------------------------------------------
   this.inputLabel = new Label( this );
   this.inputLabel.text = "Input:";
   this.inputLabel.minWidth = labelWidth;
   this.inputLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;

   this.inputCombo = new ComboBox( this );
   for ( var i = 0; i < INPUT_NAMES.length; ++i )
      this.inputCombo.addItem( INPUT_NAMES[i] );
   this.inputCombo.setItemText( 0, INPUT_NAME0[UI.mode] );
   this.inputCombo.currentItem = UI.inputMode;
   this.inputCombo.toolTip = "Stars-only (Stellar) / Starless (Non-Stellar): the image is already separated.\n" +
      "Combined: an image with both stars and background. Stars are removed first, the target " +
      "layer is glowed, then both are recombined.";
   this.inputCombo.onItemSelected = function( index )
   {
      UI.inputMode = index;
      self.updateInputControls();
      self.schedulePreview();
   };

   this.inputSizer = new HorizontalSizer;
   this.inputSizer.spacing = 4;
   this.inputSizer.add( this.inputLabel );
   this.inputSizer.add( this.inputCombo );
   this.inputSizer.addStretch();

   this.toolLabel = new Label( this );
   this.toolLabel.text = "Star removal:";
   this.toolLabel.minWidth = labelWidth;
   this.toolLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;

   this.toolCombo = new ComboBox( this );
   for ( var i = 0; i < TOOL_NAMES.length; ++i )
      this.toolCombo.addItem( TOOL_NAMES[i] );
   this.toolCombo.currentItem = UI.tool;
   this.toolCombo.toolTip = "Tool used to remove stars. It runs once per dialog session " +
      "(again if you switch tools); later preview updates are fast.";
   this.toolCombo.onItemSelected = function( index )
   {
      UI.tool = index;
      releaseStarsCache();
      self.schedulePreview();
   };

   this.toolSizer = new HorizontalSizer;
   this.toolSizer.spacing = 4;
   this.toolSizer.add( this.toolLabel );
   this.toolSizer.add( this.toolCombo );
   this.toolSizer.addStretch();

   this.updateInputControls = function()
   {
      var full = ( UI.inputMode == 1 );
      self.toolCombo.enabled = full;
      self.toolLabel.enabled = full;
   };

   // ---- Presets ---------------------------------------------------------
   this.presetLabel = new Label( this );
   this.presetLabel.text = "Preset:";
   this.presetLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;

   this.presetCombo = new ComboBox( this );
   // Wide enough for the longest preset name in any mode (plus the arrow).
   var longest = "Custom";
   for ( var m = 0; m < MODES.length; ++m )
      for ( var i = 0; i < MODES[m].presets.length; ++i )
         if ( this.font.width( MODES[m].presets[i].name ) > this.font.width( longest ) )
            longest = MODES[m].presets[i].name;
   this.presetCombo.minWidth = this.font.width( longest ) + 50;
   this.presetCombo.toolTip = "Load a preset. Any change to a setting switches this to Custom.";
   this.presetCombo.onItemSelected = function( index )
   {
      if ( self.syncing || index < 1 )
         return;                       // "Custom" does nothing by itself
      var v = currentMode().presets[index - 1].values;
      for ( var key in v )
         G[key] = v[key];
      self.syncControls();
      self.updatePreview();
   };

   // ---- Parameter controls ----------------------------------------------
   function addNumeric( label, min, max, precision, key, tip )
   {
      var c = new NumericControl( self );
      c.label.text = label;
      c.label.minWidth = labelWidth;
      c.setRange( min, max );
      c.slider.setRange( 0, 1000 );
      c.slider.minWidth = 220;
      c.setPrecision( precision );
      c.setValue( G[key] );
      c.toolTip = tip;
      c.onValueUpdated = function( value )
      {
         G[key] = value;
         self.updatePresetCombo();
         self.schedulePreview();
      };
      self.numerics[key] = c;
      return c;
   }

   this.helpLabel = new Label( this );
   this.helpLabel.frameStyle = FrameStyle_Box;
   this.helpLabel.margin = 6;
   this.helpLabel.wordWrapping = true;
   this.helpLabel.useRichText = true;
   this.helpLabel.minWidth = 380;
   this.helpText = function()
   {
      var head = "<p><b>" + TITLE + " v" + VERSION + "</b> | " + AUTHOR + "</p>";
      var body = isObjectMode()
         ? "<p>Adds a soft bloom to nebulae and galaxies using iterative Gaussian blur passes. " +
           "Run on a stretched starless image, or on a combined image with <i>Input</i> set " +
           "to <i>Combined</i> to remove stars first. Pick a Natural preset to start.</p>"
         : "<p>Adds a realistic glow to stars using iterative Gaussian blur passes. Run on a " +
           "stretched stars-only image, or on a combined image with <i>Input</i> set to " +
           "<i>Combined</i> to remove stars first.</p>";
      var foot = "<p><i>Press the Preview button to start processing.</i></p>";
      return head + body + foot;
   };
   this.helpLabel.text = this.helpText();

   this.passesControl    = addNumeric( "Blur passes:",          1,   12,  0, "passes",
      "How many blur passes. More passes = wider, smoother falloff." );
   this.sigmaControl     = addNumeric( "First pass sigma:",     0.5, 20,  2, "baseSigma",
      "Gaussian sigma (pixels) of the first, tightest pass. Larger values suit " +
      "large-scale objects." );
   this.growthControl    = addNumeric( "Sigma growth factor:",  1.1, 3,   2, "growth",
      "Each pass's sigma is the previous one multiplied by this." );
   this.decayControl     = addNumeric( "Weight decay:",         0.3, 1,   2, "decay",
      "How quickly outer halos fade. Lower = tighter glow; 1.0 = all passes equal." );
   this.strengthControl  = addNumeric( "Glow strength:",        0.05, 30, 2, "strength",
      "Overall intensity of the glow. Values above ~3 give very strong, bloomy halos; " +
      "10-30 is extreme. Type a value in the box for fine control." );
   this.thresholdControl = addNumeric( "Threshold:",            0,   0.98, 3, "threshold",
      "Stellar: only stars brighter than this glow (sharp cutoff).\n" +
      "Non-Stellar: only brightness above this level blooms, so faint background stays dark." );
   this.starSizeControl  = addNumeric( "Star size filter:",     0,   10,  1, "starSize",
      "Rejects small stars (px). Stars are blurred by this amount before the " +
      "threshold test, so small stars fall below it while big ones survive. 0 = off." );
   this.glowSatControl   = addNumeric( "Glow saturation:",      0,   3,   2, "glowSat",
      "Colour saturation of the glow only (stars and background are untouched). " +
      "0 = white glow, 1 = natural, above 1 = more colourful halos. " +
      "Has no effect on mono images." );
   this.glowSatControl.enabled = this.srcImage.isColor;

   // ---- Highlight protection --------------------------------------------
   this.hlProtectControl = addNumeric( "Highlight protection:", 0,  1,   2, "hlProtect",
      "Lightness mask that holds the glow back from areas that are already bright, " +
      "so intense glow doesn't wash out cores and highlights. 0 = off, " +
      "1 = no glow added on pure white." );
   this.hlFeatherControl = addNumeric( "Mask feather:",         0,   50,  1, "hlFeather",
      "Softens the highlight-protection mask (blur radius in px). Higher values " +
      "give smoother transitions between protected and glowing areas. " +
      "Only used when Highlight protection is above 0." );

   // ---- SCNR ------------------------------------------------------------
   this.scnrAmountControl = addNumeric( "SCNR amount:",         0,   1,   2, "scnrAmount",
      "Removes green cast from the stars and their glow (average neutral, " +
      "lightness preserved). 0 = off, 1 = full SCNR. The starless background " +
      "is not affected. Has no effect on mono images." );
   this.scnrAmountControl.enabled = this.srcImage.isColor;

   // ---- Advanced settings toggle ----------------------------------------
   this.advancedCheck = new CheckBox( this );
   this.advancedCheck.text = "Show advanced settings";
   this.advancedCheck.checked = UI.showAdvanced;
   this.advancedCheck.toolTip = "Show First pass sigma, Sigma growth factor, Weight decay, " +
      "Threshold and Star size filter. Their values are always used, even when hidden.";
   this.advancedCheck.onCheck = function( checked )
   {
      UI.showAdvanced = checked;
      self.updateAdvancedControls();
      self.adjustToContents();
   };

   this.advancedRow = new HorizontalSizer;
   this.advancedRow.addSpacing( labelWidth + 4 );
   this.advancedRow.add( this.advancedCheck );
   this.advancedRow.addStretch();

   this.updateAdvancedControls = function()
   {
      var stars = !isObjectMode();
      self.sigmaControl.visible      = UI.showAdvanced;
      self.growthControl.visible     = UI.showAdvanced;
      self.decayControl.visible      = UI.showAdvanced;
      self.thresholdControl.visible  = UI.showAdvanced;
      self.starSizeControl.visible   = UI.showAdvanced && stars;   // stars only
      self.scnrAmountControl.visible = stars;                      // stars only
   };

   this.rolloffLabel = new Label( this );
   this.rolloffLabel.text = "Highlight rolloff:";
   this.rolloffLabel.minWidth = labelWidth;
   this.rolloffLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;

   this.rolloffCombo = new ComboBox( this );
   for ( var i = 0; i < ROLLOFF_NAMES.length; ++i )
      this.rolloffCombo.addItem( ROLLOFF_NAMES[i] );
   this.rolloffCombo.currentItem = G.rolloff;
   this.rolloffCombo.toolTip = "How the glow is compressed as it approaches white. " +
      "Smooth gives the most natural falloff at high strengths.";
   this.rolloffCombo.onItemSelected = function( index )
   {
      G.rolloff = index;
      self.updatePresetCombo();
      self.schedulePreview();
   };

   this.rolloffSizer = new HorizontalSizer;
   this.rolloffSizer.spacing = 4;
   this.rolloffSizer.add( this.rolloffLabel );
   this.rolloffSizer.add( this.rolloffCombo );
   this.rolloffSizer.addStretch();

   this.keepGlowCheck = new CheckBox( this );
   this.keepGlowCheck.text = "Keep glow layer as a separate image";
   this.keepGlowCheck.checked = G.keepGlow;
   this.keepGlowCheck.onCheck = function( checked ) { G.keepGlow = checked; };

   this.checksSizer = new VerticalSizer;
   this.checksSizer.spacing = 4;
   this.checksSizer.add( this.keepGlowCheck );

   this.checksRow = new HorizontalSizer;
   this.checksRow.addSpacing( labelWidth + 4 );
   this.checksRow.add( this.checksSizer );
   this.checksRow.addStretch();

   // ---- Preview options -------------------------------------------------
   this.liveCheck = new CheckBox( this );
   this.liveCheck.text = "Live update";
   this.liveCheck.checked = UI.liveUpdate;
   this.liveCheck.toolTip = "Re-render the preview automatically when a setting changes.";
   this.liveCheck.onCheck = function( checked )
   {
      UI.liveUpdate = checked;
      if ( checked ) self.schedulePreview();
   };

   this.originalCheck = new CheckBox( this );
   this.originalCheck.text = "Show original";
   this.originalCheck.toolTip = "Toggle to compare before / after.";
   this.originalCheck.onCheck = function() { self.preview.repaint(); };

   this.sizeLabel = new Label( this );
   this.sizeLabel.text = "Size:";
   this.sizeLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;

   this.sizeCombo = new ComboBox( this );
   for ( var i = 0; i < PREVIEW_SIZES.length; ++i )
      this.sizeCombo.addItem( PREVIEW_SIZES[i] + " px" );
   this.sizeCombo.currentItem = UI.previewSizeIndex;
   this.sizeCombo.toolTip = "Minimum preview size. Make the dialog window larger to enlarge the preview further.";
   this.sizeCombo.onItemSelected = function( index )
   {
      UI.previewSizeIndex = index;
      self.previewSize = PREVIEW_SIZES[index];
      self.preview.setMinSize( self.previewSize, self.previewSize );
      self.adjustToContents();
      self.updatePreview();
   };

   this.regionLabel = new Label( this );
   this.regionLabel.text = "Region:";
   this.regionLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;

   this.regionCombo = new ComboBox( this );
   this.rebuildRegionCombo = function()
   {
      self.rebuildingRegion = true;      // ignore selection events while refilling
      self.regionCombo.clear();
      self.regionCombo.addItem( "Whole image (1/3 res)" );
      self.regionCombo.addItem( "Crop 1:1 (drag to pan)" );
      for ( var i = 0; i < self.piPreviews.length; ++i )
         self.regionCombo.addItem( "Preview: " + self.piPreviews[i].id );
      self.regionCombo.currentItem = self.regionIndex;
      self.rebuildingRegion = false;
   };
   this.rebuildRegionCombo();
   this.regionCombo.toolTip = "Whole image: the full frame processed at 1/3 resolution and fitted " +
      "to the preview (fast overview; fine star detail is approximate).\n" +
      "Crop 1:1: a full-resolution crop you can drag around.\n" +
      "Preview: follow one of the preview boxes drawn on the image in PixInsight.";
   this.regionCombo.onItemSelected = function( index )
   {
      if ( self.rebuildingRegion )
         return;
      self.regionIndex = index;
      self.updateRegionControls();
      self.updatePreview();
   };

   this.updateRegionControls = function()
   {
      var free = ( self.regionIndex == 1 );
      self.centerButton.enabled = free;
      if ( self.regionIndex == 0 )
         self.preview.toolTip = "Whole image at 1/3 resolution. Choose Crop 1:1 in the Region " +
                                "menu to inspect detail.";
      else if ( free )
         self.preview.toolTip = "Drag to pan around the image.";
      else
         self.preview.toolTip = "Showing PixInsight preview " +
                                self.piPreviews[self.regionIndex - 2].id +
                                ". Choose Crop 1:1 in the Region menu to pan.";
   };

   this.centerButton = new PushButton( this );
   this.centerButton.text = "Center";
   this.centerButton.toolTip = "Move the preview back to the image centre.";
   this.centerButton.onClick = function()
   {
      self.cx = self.srcImage.width  / 2;
      self.cy = self.srcImage.height / 2;
      self.updatePreview();
   };

   this.refreshButton = new PushButton( this );
   this.refreshButton.text = "Preview";
   this.refreshButton.toolTip = "Re-render the preview. With Combined input this also runs star " +
      "removal the first time (it never runs automatically, as it can be slow).";
   this.refreshButton.onClick = function() { self.updatePreview( true ); };

   this.previewOptsSizer = new HorizontalSizer;
   this.previewOptsSizer.spacing = 6;
   this.previewOptsSizer.add( this.liveCheck );
   this.previewOptsSizer.add( this.originalCheck );
   this.previewOptsSizer.addStretch();
   this.previewOptsSizer.add( this.regionLabel );
   this.previewOptsSizer.add( this.regionCombo );
   this.previewOptsSizer.add( this.sizeLabel );
   this.previewOptsSizer.add( this.sizeCombo );
   this.previewOptsSizer.add( this.centerButton );
   this.previewOptsSizer.add( this.refreshButton );

   // ---- Preview control -------------------------------------------------
   this.preview = new Control( this );
   this.preview.setMinSize( this.previewSize, this.previewSize );   // grows with the window
   this.preview.toolTip = "Drag to pan around the image.";

   // Window resized: the whole-image and preview-box views just refit the
   // bitmaps they already have; the 1:1 crop is re-rendered (debounced),
   // because a bigger box shows a bigger area.
   this.resizeTimer = new Timer;
   this.resizeTimer.interval = 0.4;
   this.resizeTimer.periodic = false;
   this.resizeTimer.onTimeout = function() { self.updatePreview(); };

   this.preview.onResize = function( wNew, hNew, wOld, hOld )
   {
      if ( self.busy )
         return;
      if ( self.regionIndex == 1 )
      {
         self.resizeTimer.stop();
         self.resizeTimer.start();
      }
      else
      {
         self.refitBitmaps();
         this.repaint();
      }
   };

   this.preview.onPaint = function( x0, y0, x1, y1 )
   {
      var g = new Graphics( this );
      g.fillRect( 0, 0, this.width, this.height, new Brush( 0xff181818 ) );
      var bmp = self.originalCheck.checked ? self.beforeBmp : self.afterBmp;
      if ( bmp != null )
      {
         var ox = Math.floor( (this.width  - bmp.width ) / 2 ) + self.dragDX;
         var oy = Math.floor( (this.height - bmp.height) / 2 ) + self.dragDY;
         g.drawBitmap( ox, oy, bmp );
      }
      if ( self.busy )
      {
         g.pen = new Pen( 0xffffcc00 );
         g.drawText( 8, 18, "Rendering..." );
      }
      g.end();
   };

   this.preview.onMousePress = function( x, y, button, buttonState, modifiers )
   {
      if ( self.regionIndex != 1 )
         return;                       // only the free crop can be dragged
      self.dragging = true;
      self.dragX0 = x;
      self.dragY0 = y;
   };

   this.preview.onMouseMove = function( x, y, buttonState, modifiers )
   {
      if ( !self.dragging )
         return;
      self.dragDX = x - self.dragX0;
      self.dragDY = y - self.dragY0;
      this.repaint();
   };

   this.preview.onMouseRelease = function( x, y, button, buttonState, modifiers )
   {
      if ( !self.dragging )
         return;
      self.dragging = false;
      self.cx -= x - self.dragX0;    // drag right = look further left
      self.cy -= y - self.dragY0;
      self.dragDX = self.dragDY = 0;
      self.updatePreview();
   };

   this.statusLabel = new Label( this );
   this.statusLabel.text = "";

   // ---- Preview rendering -----------------------------------------------
   // Regions bigger than the preview box are scaled down to fit.
   // Returns a short description of the scale for the status line.
   // fitBitmaps keeps the freshly rendered bitmaps as the unscaled originals,
   // then refitBitmaps scales them to the current preview box size.
   this.fitBitmaps = function( cw, ch )
   {
      self.rawBefore = self.beforeBmp;
      self.rawAfter  = self.afterBmp;
      self.rawW = cw;
      self.rawH = ch;
      return self.refitBitmaps();
   };

   this.refitBitmaps = function()
   {
      if ( self.rawBefore == null && self.rawAfter == null )
         return "";
      var pw = Math.max( 1, self.preview.width ), ph = Math.max( 1, self.preview.height );
      var f = Math.min( 1, pw/self.rawW, ph/self.rawH );
      if ( f >= 1 )
      {
         self.beforeBmp = self.rawBefore;
         self.afterBmp  = self.rawAfter;
         return "1:1";
      }
      var sw = Math.max( 1, Math.round( self.rawW*f ) ), sh = Math.max( 1, Math.round( self.rawH*f ) );
      self.beforeBmp = ( self.rawBefore != null ) ? self.rawBefore.scaledTo( sw, sh ) : null;
      self.afterBmp  = ( self.rawAfter  != null ) ? self.rawAfter.scaledTo( sw, sh )  : null;
      return format( "scaled to %d%%", Math.round( f*100 ) );
   };

   // Whole image preview: the full frame at 1/PREVIEW_DOWNSAMPLE resolution.
   this.updateWholePreview = function( allowRemoval )
   {
      var full = ( UI.inputMode == 1 );
      var needRemoval = full && ( STARS_CACHE == null || STARS_CACHE.tool != UI.tool );
      var t0 = new Date;
      var out = null;

      self.busy = true;
      self.preview.repaint();
      processEvents();
      try
      {
         var small = smallOriginal( self.srcImage );
         var sw = small.mainView.image.width, sh = small.mainView.image.height;
         self.beforeBmp = small.mainView.image.render();

         if ( needRemoval && !allowRemoval )
         {
            self.afterBmp = self.beforeBmp;
            var st = self.fitBitmaps( sw, sh );
            self.statusLabel.text = "Showing original (" + st + "). Press Preview to remove stars with " +
                                    TOOL_NAMES[UI.tool] + " and preview the glow.";
            return;
         }

         if ( needRemoval )
         {
            self.statusLabel.text = "Removing stars with " + TOOL_NAMES[UI.tool] +
                                    " (one time, may take a while)...";
            processEvents();
            ensureStars( self.srcWindow );
         }
         if ( full )
            ensureSmallLayers();

         var src = full ? smallGlowLayer().mainView.image : small.mainView.image;
         out = buildGlow( src, "StellarRadiance_pvres", "StellarRadiance_pvglow", false, false,
                          PREVIEW_DOWNSAMPLE );
         if ( full )
            recombine( out.result.mainView, smallOtherLayer().mainView.id );

         self.afterBmp = out.result.mainView.image.render();
         var scaleText = self.fitBitmaps( sw, sh );
         self.statusLabel.text = format( "Whole image at 1/%d resolution (%dx%d px, %s, approximate)  -  %.2f s",
                                         PREVIEW_DOWNSAMPLE, sw, sh, scaleText, (new Date - t0)/1000 );
      }
      catch ( e )
      {
         self.statusLabel.text = "Preview error: " + e.toString();
         console.criticalln( "StellarRadiance preview error: " + e.toString() );
      }
      finally
      {
         if ( out != null && out.result != null ) out.result.forceClose();
         self.busy = false;
         self.preview.repaint();
      }
   };

   // allowRemoval: only true when the user presses Preview. Star removal
   // (StarNet2 / StarXTerminator) can be slow, so it never runs on its own
   // when the dialog opens or on live updates.
   this.updatePreview = function( allowRemoval )
   {
      if ( self.busy )
         return;
      self.timer.stop();

      if ( self.regionIndex == 0 )
      {
         self.updateWholePreview( allowRemoval );
         return;
      }

      var img = self.srcImage;
      var x0, y0, cw, ch;
      var regionName = "";

      if ( self.regionIndex > 1 )
      {
         // Follow a PixInsight preview box (image coordinates).
         var pv = self.piPreviews[self.regionIndex - 2];
         var r  = self.srcWindow.previewRect( pv );
         x0 = Math.max( 0, r.x0 );
         y0 = Math.max( 0, r.y0 );
         cw = Math.min( img.width,  r.x1 ) - x0;
         ch = Math.min( img.height, r.y1 ) - y0;
         regionName = pv.id + ": ";
      }
      else
      {
         cw = Math.min( Math.max( 1, self.preview.width  ), img.width  );
         ch = Math.min( Math.max( 1, self.preview.height ), img.height );

         // clamp the centre so the crop stays inside the image
         self.cx = Math.max( cw/2, Math.min( img.width  - cw/2, self.cx ) );
         self.cy = Math.max( ch/2, Math.min( img.height - ch/2, self.cy ) );
         x0 = Math.round( self.cx - cw/2 );
         y0 = Math.round( self.cy - ch/2 );
      }

      // Full-image mode without extracted stars yet: show the original and
      // wait for Preview instead of starting star removal automatically.
      if ( UI.inputMode == 1 && ( STARS_CACHE == null || STARS_CACHE.tool != UI.tool ) && !allowRemoval )
      {
         var orig = new Image;
         copyNominal( orig, img, new Rect( x0, y0, x0 + cw, y0 + ch ) );
         self.beforeBmp = orig.render();
         orig.free();
         self.afterBmp = self.beforeBmp;
         var st = self.fitBitmaps( cw, ch );
         self.statusLabel.text = "Showing original (" + st + "). Press Preview to remove stars with " +
                                 TOOL_NAMES[UI.tool] + " and preview the glow.";
         self.preview.repaint();
         return;
      }

      // pad the crop so the blur near the crop edges is the same as in the full image
      var pad = Math.ceil( 3*(effectiveSigma() + selectionPad()) ) + 2;
      var px0 = Math.max( 0, x0 - pad ),         py0 = Math.max( 0, y0 - pad );
      var px1 = Math.min( img.width,  x0 + cw + pad );
      var py1 = Math.min( img.height, y0 + ch + pad );

      self.busy = true;
      self.preview.repaint();
      processEvents();

      var t0 = new Date;
      var crop = null, cropSL = null, out = null;
      try
      {
         var full = ( UI.inputMode == 1 );
         if ( full && ( STARS_CACHE == null || STARS_CACHE.tool != UI.tool ) )
         {
            self.statusLabel.text = "Removing stars with " + TOOL_NAMES[UI.tool] +
                                    " (one time, may take a while)...";
            processEvents();
            ensureStars( self.srcWindow );
         }

         var padRect   = new Rect( px0, py0, px1, py1 );
         var starsImg  = full ? glowLayer().mainView.image : img;

         crop = new ImageWindow( px1 - px0, py1 - py0, nominalChannels( img ),
                                 32, true, img.isColor, "StellarRadiance_pvsrc" );
         crop.mainView.beginProcess( UndoFlag_NoSwapFile );
         copyNominal( crop.mainView.image, starsImg, padRect );
         crop.mainView.endProcess();

         out = buildGlow( crop.mainView.image, "StellarRadiance_pvres", "StellarRadiance_pvglow", false, false );

         if ( full )
         {
            cropSL = new ImageWindow( px1 - px0, py1 - py0, nominalChannels( img ),
                                      32, true, img.isColor, "StellarRadiance_pvsl" );
            cropSL.mainView.beginProcess( UndoFlag_NoSwapFile );
            copyNominal( cropSL.mainView.image, otherLayer().mainView.image, padRect );
            cropSL.mainView.endProcess();
            recombine( out.result.mainView, cropSL.mainView.id );
         }

         var inner = new Rect( x0 - px0, y0 - py0, x0 - px0 + cw, y0 - py0 + ch );

         var after = new Image;
         after.assign( out.result.mainView.image, inner );
         self.afterBmp = after.render();
         after.free();

         var before = new Image;
         copyNominal( before, img, new Rect( x0, y0, x0 + cw, y0 + ch ) );
         self.beforeBmp = before.render();
         before.free();

         var scaleText = self.fitBitmaps( cw, ch );

         self.statusLabel.text = format( "%sx=%d, y=%d (%dx%d px, %s)  -  %.2f s",
                                         regionName, x0, y0, cw, ch, scaleText,
                                         (new Date - t0)/1000 );
      }
      catch ( e )
      {
         self.statusLabel.text = "Preview error: " + e.toString();
         console.criticalln( "StellarRadiance preview error: " + e.toString() );
      }
      finally
      {
         if ( out  != null && out.result != null ) out.result.forceClose();
         if ( crop   != null ) crop.forceClose();
         if ( cropSL != null ) cropSL.forceClose();
         self.busy = false;
         self.preview.repaint();
      }
   };

   // ---- Buttons ---------------------------------------------------------
   this.okButton = new PushButton( this );
   this.okButton.text = "OK";
   this.okButton.icon = this.scaledResource( ":/icons/ok.png" );
   this.okButton.onClick = function() { self.timer.stop(); self.resizeTimer.stop(); saveSettings(); self.ok(); };

   this.cancelButton = new PushButton( this );
   this.cancelButton.text = "Cancel";
   this.cancelButton.icon = this.scaledResource( ":/icons/cancel.png" );
   this.cancelButton.onClick = function()
   {
      self.timer.stop();
      self.resizeTimer.stop();
      releaseStarsCache();
      releaseSmallCache();
      self.cancel();
   };

   this.resetButton = new PushButton( this );
   this.resetButton.text = "Reset";
   this.resetButton.icon = this.scaledResource( ":/icons/reload.png" );
   this.resetButton.toolTip = "Restore the current glow target's settings to their defaults.";
   this.resetButton.onClick = function()
   {
      var d = currentMode().defaults;
      for ( var key in d )
         G[key] = d[key];
      self.syncControls();
      self.updatePreview();
   };

   this.buttonsSizer = new HorizontalSizer;
   this.buttonsSizer.spacing = 6;
   this.buttonsSizer.add( this.resetButton );
   this.buttonsSizer.addStretch();
   this.buttonsSizer.add( this.okButton );
   this.buttonsSizer.add( this.cancelButton );

   // ---- Layout ----------------------------------------------------------
   this.leftSizer = new VerticalSizer;
   this.leftSizer.spacing = 6;
   this.presetSizer = new HorizontalSizer;
   this.presetSizer.spacing = 4;
   this.presetLabel.minWidth = labelWidth;
   this.presetSizer.add( this.presetLabel );
   this.presetSizer.add( this.presetCombo );
   this.presetSizer.addStretch();

   this.leftSizer.add( this.helpLabel );
   this.leftSizer.addSpacing( 4 );
   this.leftSizer.add( this.imageSizer );
   this.leftSizer.add( this.modeSizer );
   this.leftSizer.add( this.inputSizer );
   this.leftSizer.add( this.toolSizer );
   this.leftSizer.addSpacing( 4 );
   this.leftSizer.add( this.presetSizer );
   this.leftSizer.addSpacing( 4 );
   this.leftSizer.add( this.passesControl );
   this.leftSizer.add( this.sigmaControl );
   this.leftSizer.add( this.growthControl );
   this.leftSizer.add( this.decayControl );
   this.leftSizer.add( this.strengthControl );
   this.leftSizer.add( this.thresholdControl );
   this.leftSizer.add( this.starSizeControl );
   this.leftSizer.add( this.glowSatControl );
   this.leftSizer.add( this.hlProtectControl );
   this.leftSizer.add( this.hlFeatherControl );
   this.leftSizer.add( this.scnrAmountControl );
   this.leftSizer.add( this.rolloffSizer );
   this.leftSizer.add( this.checksRow );
   this.leftSizer.add( this.advancedRow );
   this.leftSizer.addStretch();
   this.leftSizer.add( this.buttonsSizer );

   this.rightSizer = new VerticalSizer;
   this.rightSizer.spacing = 4;
   this.rightSizer.add( this.previewOptsSizer );
   this.rightSizer.add( this.preview, 100 );        // takes all extra space
   this.rightSizer.add( this.statusLabel );

   this.sizer = new HorizontalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 10;
   this.sizer.add( this.leftSizer );
   this.sizer.add( this.rightSizer, 100 );

   this.rebuildPresetCombo();
   this.updatePresetCombo();
   this.updateInputControls();
   this.updateRegionControls();
   this.updateAdvancedControls();

   this.windowTitle = TITLE + " v" + VERSION;
   this.userResizable = true;
   this.adjustToContents();

   this.onShow = function() { self.updatePreview(); };
}

StellarRadianceDialog.prototype = new Dialog;

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------
function main()
{
   console.show();

   var win = ImageWindow.activeWindow;
   if ( win.isNull )
   {
      new MessageBox( "Please open and select an image first.",
                      TITLE, StdIcon_Error, StdButton_Ok ).execute();
      return;
   }

   loadSettings();

   var dlg = new StellarRadianceDialog( win );
   var accepted = dlg.execute();
   releaseSmallCache();               // preview-only data
   if ( !accepted )
   {
      releaseStarsCache();
      return;
   }

   G.passes = numPasses();
   win = dlg.srcWindow;               // the image chosen in the Image menu

   var t0 = new Date;
   try
   {
      applyStellarRadiance( win );
   }
   catch ( e )
   {
      releaseStarsCache();
      new MessageBox( e.toString(), TITLE, StdIcon_Error, StdButton_Ok ).execute();
      return;
   }
   console.writeln( format( "<b>%s</b> done in %.2f s", TITLE, (new Date - t0)/1000 ) );
}

main();
