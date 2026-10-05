/*
 * Image processing for the photo lab.
 * Needs the CanvasPlus and triangulate globals from assets/js/vendor/.
 * This file has no page code. app.js decides when to call it.
 */
(function () {
  'use strict';

  var MB = 1024 * 1024;

  var LIMITS = {
    types: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 15 * MB,
    maxPixels: 40 * 1000 * 1000
  };

  // Slider positions 1, 2 and 3 map to Low, Medium and High.
  var RESOLUTION = { 1: 320, 2: 480, 3: 720 };
  var POLYGON_DETAIL = { 1: 300, 2: 1200, 3: 4000 };
  var PALETTE_SIZES = [4, 8, 16, 32, 64, 128, 256];

  // The PS2-inspired color treatment, applied before the palette is reduced.
  var PRESET = {
    saturation: 45,
    contrast: 15,
    brightness: -10,
    temperature: 0
  };

  // Settings passed to triangulate-image, apart from the point count.
  var TRIANGLES = {
    accuracy: 0.7,
    blur: 4,
    threshold: 50,
    fill: true,
    stroke: true,
    strokeWidth: 0.5
  };

  // How strongly the triangles cover the photo, from 0 (photo only) to 1 (triangles only).
  var BLEND = {
    triangleOpacity: 0.4
  };

  // PS2-era screen look from pixi-filters, applied after the color preset and
  // before palette reduction. The animated preview uses the same values.
  var SCREEN = {
    bloom: { threshold: 0.85, bloomScale: 0.25, brightness: 1, blur: 4, quality: 4 },
    rgbSplit: { red: { x: -1, y: 0 }, green: { x: 0, y: 0 }, blue: { x: 1, y: 0 } },
    crt: {
      curvature: 2, lineWidth: 1, lineContrast: 0.15, noise: 0.12, noiseSize: 1,
      vignetting: 0.3, vignettingAlpha: 0.5, vignettingBlur: 0.3, time: 0, seed: 0.5
    }
  };

  // Canvas versions of the screen effects. Used only when WebGL or PixiJS isn't available.
  var EFFECTS = {
    // Bright areas glow. threshold: brightness (0-255) where the glow starts.
    // strength: how much of the glow is added. blur: how far the glow spreads.
    bloom: { enabled: true, threshold: 200, strength: 0.35, blur: 8 },
    // A CRT TV look. scanline: how much every other row is darkened.
    // fringe: how many pixels red and blue are shifted. vignette: how much the corners darken.
    crt: { enabled: true, scanline: 0.08, fringe: 1, vignette: 0.25 }
  };

  // Dithering methods: none, error diffusion (Floyd-Steinberg) or an ordered 4x4 grid like the PS2 used.
  var DITHER_MODES = ['off', 'diffusion', 'ordered'];

  // Strength of the ordered pattern, as a share of the average gap between palette colors.
  var ORDERED = { spread: 0.6 };

  // 4x4 Bayer matrix. Each cell sets how much a pixel at that grid position is nudged.
  var BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  function fail(message) {
    throw new Error(message);
  }

  // Filters in canvas-plus don't throw. They store the error instead.
  function checkStep(canvas, step) {
    var err = canvas.getLastError();
    if (err) fail(step + ' failed: ' + err.message);
  }

  function now() {
    return performance.now();
  }

  // Returns null if the file is fine, or a reason it can't be used.
  function checkFile(file) {
    if (!file) return 'No file was selected.';
    if (LIMITS.types.indexOf(file.type) === -1) return 'This file type isn’t supported. Use a JPG, PNG or WebP image.';
    if (file.size > LIMITS.maxBytes) return 'This file is larger than 15 MB.';
    return null;
  }

  // Loads a File, Blob or same-site URL into a new CanvasPlus object.
  function loadImage(source) {
    return new Promise(function (resolve, reject) {
      var canvas = new CanvasPlus();
      canvas.load(source, function (err) {
        if (err) return reject(new Error('The image could not be opened.'));
        var pixels = canvas.get('width') * canvas.get('height');
        if (!pixels) return reject(new Error('The image could not be opened.'));
        if (pixels > LIMITS.maxPixels) return reject(new Error('This image has more than 40 megapixels.'));
        resolve(canvas);
      });
    });
  }

  // Returns a smaller copy. The original stays untouched so it can be resized again.
  function resizeImage(original, resolution) {
    var size = RESOLUTION[resolution];
    if (!size) fail('Unknown resolution: ' + resolution);

    var copy = original.clone();
    checkStep(original, 'Copy');
    copy.resize({ width: size, height: size, mode: 'fit', direction: 'shrink' });
    checkStep(copy, 'Resize');
    copy.render();
    return copy;
  }

  function triangulateCanvas(canvas, vertexCount) {
    var width = canvas.get('width');
    var height = canvas.get('height');
    var source = canvas.getContext().getImageData(0, 0, width, height);

    var params = Object.assign({}, TRIANGLES, { vertexCount: vertexCount });
    var result = triangulate(params).fromImageDataSync(source).toImageDataSync();

    var triangles = document.createElement('canvas');
    triangles.width = width;
    triangles.height = height;
    triangles.getContext('2d').putImageData(result, 0, 0);

    // Triangle edges are smoothed against transparency. Drawing them over the
    // photo keeps every pixel opaque, so no faint seams or see-through pixels
    // end up in the palette.
    var output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    var ctx = output.getContext('2d');
    ctx.drawImage(canvas.getCanvas(), 0, 0);
    ctx.globalAlpha = BLEND.triangleOpacity;
    ctx.drawImage(triangles, 0, 0);
    canvas.importCanvas(output);
    checkStep(canvas, 'Triangles');
  }

  function makeCanvas(width, height) {
    var c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }

  // Copies the bright parts, blurs them by shrinking and enlarging, then blends them back.
  function applyBloom(canvas) {
    var settings = EFFECTS.bloom;
    var width = canvas.get('width');
    var height = canvas.get('height');
    var ctx = canvas.getContext();
    var src = ctx.getImageData(0, 0, width, height).data;

    var bright = new ImageData(width, height);
    var out = bright.data;
    var range = 255 - settings.threshold;
    for (var i = 0; i < src.length; i += 4) {
      var lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
      var k = Math.max(0, (lum - settings.threshold) / range);
      out[i] = src[i] * k;
      out[i + 1] = src[i + 1] * k;
      out[i + 2] = src[i + 2] * k;
      out[i + 3] = 255;
    }

    var layer = makeCanvas(width, height);
    layer.getContext('2d').putImageData(bright, 0, 0);

    // Shrinking in halves and then enlarging gives a soft blur in every browser.
    var steps = Math.round(Math.log2(settings.blur));
    var current = layer;
    for (var s = 0; s < steps; s++) {
      var next = makeCanvas(Math.max(1, Math.round(current.width / 2)), Math.max(1, Math.round(current.height / 2)));
      next.getContext('2d').drawImage(current, 0, 0, next.width, next.height);
      current = next;
    }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = settings.strength;
    ctx.drawImage(current, 0, 0, width, height);
    ctx.restore();
  }

  // Scanlines, red and blue fringing, and darker corners, in one pass over the pixels.
  function applyCrt(canvas) {
    var settings = EFFECTS.crt;
    var width = canvas.get('width');
    var height = canvas.get('height');
    var ctx = canvas.getContext();
    var image = ctx.getImageData(0, 0, width, height);
    var out = image.data;
    var src = new Uint8ClampedArray(out);

    var cx = width / 2;
    var cy = height / 2;
    var maxDist2 = cx * cx + cy * cy;
    var shift = settings.fringe;

    for (var y = 0; y < height; y++) {
      var row = y % 2 === 1 ? 1 - settings.scanline : 1;
      var dy = y - cy;
      for (var x = 0; x < width; x++) {
        var i = (y * width + x) * 4;
        var redIndex = (y * width + Math.min(width - 1, x + shift)) * 4;
        var blueIndex = (y * width + Math.max(0, x - shift)) * 4;
        var dx = x - cx;
        var factor = row * (1 - settings.vignette * (dx * dx + dy * dy) / maxDist2);
        out[i] = src[redIndex] * factor;
        out[i + 1] = src[i + 1] * factor;
        out[i + 2] = src[blueIndex + 2] * factor;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  // Nudges each pixel by a repeating 4x4 pattern. Palette reduction then snaps
  // neighboring pixels to different colors in a regular cross-hatch.
  function applyOrderedPattern(canvas, colors) {
    var width = canvas.get('width');
    var height = canvas.get('height');
    var ctx = canvas.getContext();
    var image = ctx.getImageData(0, 0, width, height);
    var data = image.data;

    // Rough gap between neighboring palette colors in each channel.
    var amount = (256 / Math.cbrt(colors)) * ORDERED.spread;

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var nudge = ((BAYER_4[(y % 4) * 4 + (x % 4)] + 0.5) / 16 - 0.5) * amount;
        var i = (y * width + x) * 4;
        data[i] += nudge;
        data[i + 1] += nudge;
        data[i + 2] += nudge;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  function copyCanvas(source) {
    var c = makeCanvas(source.width, source.height);
    c.getContext('2d').drawImage(source, 0, 0);
    return c;
  }

  // Builds the pixi-filters chain: glow, red and blue split, then the CRT screen.
  function makeScreenFilters() {
    return [
      new PIXI.filters.AdvancedBloomFilter(Object.assign({}, SCREEN.bloom)),
      new PIXI.filters.RGBSplitFilter(JSON.parse(JSON.stringify(SCREEN.rgbSplit))),
      new PIXI.filters.CRTFilter(Object.assign({}, SCREEN.crt))
    ];
  }

  var screenRenderer = null; // a hidden PixiJS renderer, created once and reused
  var screenFailed = false;  // set when PixiJS couldn't start, so it isn't retried

  function pixiAvailable() {
    return !screenFailed && typeof PIXI !== 'undefined' && !!PIXI.filters;
  }

  // PixiJS quietly falls back to a Canvas2D renderer without WebGL, and that
  // renderer skips every filter. Only WebGL and WebGPU can run the screen effects.
  function usesGpu(app) {
    var types = PIXI.RendererType;
    return app.renderer.type === types.WEBGL || app.renderer.type === types.WEBGPU;
  }

  function getScreenRenderer() {
    if (!screenRenderer) {
      var app = new PIXI.Application();
      screenRenderer = app.init({ width: 16, height: 16, preference: 'webgl', backgroundAlpha: 1, antialias: false, autoStart: false })
        .then(function () {
          if (!usesGpu(app)) {
            app.destroy();
            throw new Error('No WebGL or WebGPU');
          }
          return app;
        })
        .catch(function (err) {
          screenRenderer = null;
          screenFailed = true;
          throw err;
        });
    }
    return screenRenderer;
  }

  // Renders the image once through pixi-filters and puts the result back into canvas-plus.
  async function applyScreenPixi(canvas) {
    var app = await getScreenRenderer();
    var width = canvas.get('width');
    var height = canvas.get('height');
    var area = new PIXI.Rectangle(0, 0, width, height);

    app.renderer.resize(width, height);
    // A fresh copy with skipCache, so PixiJS never reuses an older texture.
    var sprite = new PIXI.Sprite(PIXI.Texture.from(copyCanvas(canvas.getCanvas()), true));
    var filters = makeScreenFilters();
    sprite.filters = filters;
    sprite.filterArea = area;
    app.stage.addChild(sprite);

    try {
      var extracted = app.renderer.extract.canvas({ target: app.stage, frame: area });
      canvas.importCanvas(copyCanvas(extracted));
    } finally {
      // Free the GPU memory used by this run.
      app.stage.removeChild(sprite);
      filters.forEach(function (f) { f.destroy(); });
      sprite.destroy({ texture: true, textureSource: true });
    }
  }

  function writePng(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.write({ format: 'png' }, function (err, buf) {
        if (err) return reject(new Error('The PNG could not be created.'));
        resolve(new Blob([buf], { type: 'image/png' }));
      });
    });
  }

  /*
   * Runs the filter on a copy of a resized image.
   * Order: triangles, color preset, screen effects (pixi-filters, or the canvas
   * versions without WebGL), ordered pattern (if chosen), palette reduction, export.
   * Palette reduction must come last, or canvas-plus turns the image back into full color.
   */
  async function processImage(resized, options) {
    var vertexCount = POLYGON_DETAIL[options.polygonDetail];
    if (!vertexCount) fail('Unknown polygon detail: ' + options.polygonDetail);
    if (PALETTE_SIZES.indexOf(options.colors) === -1) fail('Unknown palette size: ' + options.colors);

    // true and false are still accepted and mean error diffusion and off.
    var dither = options.dither === true ? 'diffusion' : (options.dither || 'off');
    if (DITHER_MODES.indexOf(dither) === -1) fail('Unknown dithering: ' + options.dither);

    var timings = {};
    var start = now();
    var canvas = resized.clone();
    checkStep(resized, 'Copy');

    var t = now();
    triangulateCanvas(canvas, vertexCount);
    timings.triangles = now() - t;

    t = now();
    canvas.adjust({ saturation: PRESET.saturation, contrast: PRESET.contrast, brightness: PRESET.brightness });
    checkStep(canvas, 'Color adjustment');
    canvas.temperature({ amount: PRESET.temperature });
    checkStep(canvas, 'Color temperature');
    timings.colors = now() - t;

    // The full-color image before screen effects, for the animated preview.
    var prepared = copyCanvas(canvas.getCanvas());

    t = now();
    var renderer = 'canvas';
    if (pixiAvailable()) {
      try {
        await applyScreenPixi(canvas);
        renderer = 'pixi';
      } catch (err) {
        screenFailed = true;
      }
    }
    if (renderer === 'canvas') {
      if (EFFECTS.bloom.enabled) applyBloom(canvas);
      if (EFFECTS.crt.enabled) applyCrt(canvas);
    }
    if (dither === 'ordered') applyOrderedPattern(canvas, options.colors);
    checkStep(canvas, 'Screen effects');
    timings.effects = now() - t;

    t = now();
    canvas.quantize({ colors: options.colors, dither: dither === 'diffusion', ditherType: 'FloydSteinberg' });
    checkStep(canvas, 'Palette reduction');
    timings.quantize = now() - t;

    var palette = canvas.getPalette().map(function (c) {
      return { r: c.r, g: c.g, b: c.b };
    });

    t = now();
    var blob = await writePng(canvas);
    timings.png = now() - t;
    timings.total = now() - start;

    return {
      blob: blob,
      palette: palette,
      width: canvas.get('width'),
      height: canvas.get('height'),
      prepared: prepared,
      renderer: renderer,
      timings: timings
    };
  }

  window.PhotoProcessor = {
    LIMITS: LIMITS,
    RESOLUTION: RESOLUTION,
    POLYGON_DETAIL: POLYGON_DETAIL,
    BLEND: BLEND,
    SCREEN: SCREEN,
    EFFECTS: EFFECTS,
    makeScreenFilters: makeScreenFilters,
    usesGpu: usesGpu,
    ORDERED: ORDERED,
    DITHER_MODES: DITHER_MODES,
    PALETTE_SIZES: PALETTE_SIZES,
    PRESET: PRESET,
    checkFile: checkFile,
    loadImage: loadImage,
    resizeImage: resizeImage,
    processImage: processImage
  };
})();
