/*
 * Image processing for the photo lab.
 * Needs the CanvasPlus global from assets/js/vendor/canvas-plus.js, and PixiJS
 * with pixi-filters for the screen effects (it falls back to canvas effects without them).
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
  var PALETTE_SIZES = [4, 8, 16, 32, 64, 128, 256];

  // The screen the image is placed on, with the PS2's 640x448 shape. Its size follows
  // the Resolution setting, so High is the real 640x448.
  var SCREEN_SIZES = { 320: [320, 224], 480: [480, 336], 720: [640, 448] };

  // Look presets. Each value is a slider position from 0 to 100.
  // Clean is the default. The other three follow descriptions of each game's look:
  // Shadow of the Colossus: heavy bloom, washed-out colors, a blue-white glow and bright haze.
  // Silent Hill 2: thick grey fog, heavy film grain, dark.
  // Snake Eater (Metal Gear Solid 3): a green, sepia-like color filter.
  var LOOK_PRESETS = {
    clean:      { glow: 42, fogAmount: 44, fogColor: 0,  color: 86, brightness: 40, softness: 0,  tint: 50, grain: 22, tv: 35 },
    colossus:   { glow: 60, fogAmount: 42, fogColor: 0,  color: 38, brightness: 44, softness: 67, tint: 28, grain: 22, tv: 35 },
    silenthill: { glow: 10, fogAmount: 88, fogColor: 100, color: 10, brightness: 34, softness: 67, tint: 50, grain: 25, tv: 25 },
    snakeeater: { glow: 25, fogAmount: 15, fogColor: 20, color: 64, brightness: 32, softness: 55, tint: 96, grain: 25, tv: 35 }
  };
  var LOOK_KEYS = ['glow', 'fogAmount', 'fogColor', 'color', 'brightness', 'softness', 'tint', 'grain', 'tv'];

  // Tint colors at each end of the Tint slider. 50 is neutral.
  var TINT_COOL = [150, 190, 255];
  var TINT_GREEN = [172, 178, 72];

  // The grey that "Fog color" moves toward.
  var FOG_GREY = [150, 150, 153];

  // Contrast for every look. Very heavy fog lowers it, like the flat look of fog in Silent Hill 2.
  var CONTRAST = 15;

  // PS2-era screen look from pixi-filters. Bloom comes from the Glow slider.
  // The animated preview uses the same values.
  var SCREEN = {
    rgbSplit: { red: { x: -1, y: 0 }, green: { x: 0, y: 0 }, blue: { x: 1, y: 0 } },
    // Scanlines, curve and edge darkening come from the TV effect slider, and noise from Grain.
    crt: {
      lineWidth: 1, noiseSize: 1, vignetting: 0.3, vignettingBlur: 0.3, time: 0, seed: 0.5
    }
  };

  // Canvas versions of the screen effects, used only when WebGL or PixiJS isn't available.
  // fringe: how many pixels red and blue are shifted. Scanlines and edge darkening follow the TV effect slider.
  var FALLBACK_FRINGE = 1;

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

  function share(value) {
    return Math.max(0, Math.min(100, Number(value))) / 100;
  }

  // Turns the six slider values into the settings each step uses.
  function lookSettings(look) {
    LOOK_KEYS.forEach(function (key) {
      if (typeof look[key] !== 'number') fail('Missing look value: ' + key);
    });
    var glow = share(look.glow);
    var fog = share(look.fogAmount);
    var grey = share(look.fogColor);
    var soft = share(look.softness);
    var tint = share(look.tint) - 0.5;
    var tv = share(look.tv);
    var heavyFog = Math.max(0, fog - 0.5);
    return {
      tint: { color: tint < 0 ? TINT_COOL : TINT_GREEN, strength: Math.abs(tint) * 2 * 0.5 },
      noise: 0.02 + 0.18 * share(look.grain),
      crt: { lineContrast: 0.12 * tv, curvature: 1.5 * tv, vignettingAlpha: 0.35 * tv },
      fallbackCrt: { scanline: 0.12 * tv, vignette: 0.35 * tv },
      adjust: {
        saturation: Math.round(-50 + 110 * share(look.color)),
        contrast: Math.round(CONTRAST - 25 * heavyFog),
        brightness: Math.round(-30 + 50 * share(look.brightness))
      },
      // Above the middle of the slider, a veil spreads down over the whole image.
      fog: { amount: 0.8 * fog, reach: 0.6 + 0.35 * fog, floor: Math.min(0.7, 1.2 * heavyFog), grey: grey },
      softScale: 1 - 0.6 * soft,
      bloom: {
        threshold: 0.9 - 0.2 * glow,
        bloomScale: 0.6 * glow,
        brightness: 1,
        blur: Math.round(4 + 2 * glow),
        quality: 4
      },
      fallbackBloom: { threshold: 200, strength: 0.8 * glow, blur: 8 }
    };
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

  function makeCanvas(width, height) {
    var c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }

  function copyCanvas(source) {
    var c = makeCanvas(source.width, source.height);
    c.getContext('2d').drawImage(source, 0, 0);
    return c;
  }

  // Haze that is thickest at the top (far away) and gone lower down. Its color
  // goes from the photo's sky color toward grey as "Fog color" increases.
  function applyFog(canvas, fog) {
    if (fog.amount <= 0) return;
    var width = canvas.get('width');
    var height = canvas.get('height');
    var ctx = canvas.getContext();
    var top = ctx.getImageData(0, 0, width, Math.max(1, Math.round(height * 0.1))).data;
    var r = 0, g = 0, b = 0, n = top.length / 4;
    for (var i = 0; i < top.length; i += 4) { r += top[i]; g += top[i + 1]; b += top[i + 2]; }
    // Lighten the sky color a little, the way fog washes colors out.
    var sky = [r / n * 0.75 + 255 * 0.25, g / n * 0.75 + 255 * 0.25, b / n * 0.75 + 255 * 0.25];
    var color = sky.map(function (v, k) { return Math.round(v + (FOG_GREY[k] - v) * fog.grey); }).join(',');

    var bottom = fog.amount * fog.floor;
    var gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(' + color + ',' + fog.amount + ')');
    gradient.addColorStop(Math.min(1, fog.reach), 'rgba(' + color + ',' + bottom + ')');
    gradient.addColorStop(1, 'rgba(' + color + ',' + bottom + ')');
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  // Shifts the colors toward blue-white or olive green while keeping the light and dark detail.
  function applyTint(canvas, tint) {
    if (tint.strength <= 0) return;
    var ctx = canvas.getContext();
    ctx.save();
    ctx.globalCompositeOperation = 'color';
    ctx.globalAlpha = tint.strength;
    ctx.fillStyle = 'rgb(' + tint.color.join(',') + ')';
    ctx.fillRect(0, 0, canvas.get('width'), canvas.get('height'));
    ctx.restore();
  }

  // Places the whole image on the PS2-shaped screen, with black bars where it doesn't fill it.
  // With softness, the image is shrunk first and then smoothly enlarged, like PS2 output.
  function applyScreenFrame(canvas, resolution, softScale) {
    var size = SCREEN_SIZES[RESOLUTION[resolution]];
    var width = canvas.get('width');
    var height = canvas.get('height');
    var scale = Math.min(size[0] / width, size[1] / height);
    var w = width * scale;
    var h = height * scale;

    var screen = makeCanvas(size[0], size[1]);
    var ctx = screen.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size[0], size[1]);
    ctx.imageSmoothingEnabled = true;

    var picture = canvas.getCanvas();
    if (softScale < 1) {
      var small = makeCanvas(Math.max(1, Math.round(w * softScale)), Math.max(1, Math.round(h * softScale)));
      small.getContext('2d').drawImage(picture, 0, 0, small.width, small.height);
      picture = small;
    }
    ctx.drawImage(picture, (size[0] - w) / 2, (size[1] - h) / 2, w, h);
    canvas.importCanvas(screen);
    checkStep(canvas, 'PS2 screen');
  }

  // Canvas bloom: copies the bright parts, blurs them by shrinking and enlarging, then blends them back.
  function applyBloom(canvas, settings) {
    if (settings.strength <= 0) return;
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

  // Canvas CRT: scanlines, red and blue fringing, and darker corners, in one pass over the pixels.
  function applyCrt(canvas, noise, crt) {
    var settings = { scanline: crt.scanline, vignette: crt.vignette, fringe: FALLBACK_FRINGE };
    var grain = noise * 255;
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
        var n = (Math.random() - 0.5) * grain;
        out[i] = src[redIndex] * factor + n;
        out[i + 1] = src[i + 1] * factor + n;
        out[i + 2] = src[blueIndex + 2] * factor + n;
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

  // Builds the pixi-filters chain: glow, red and blue split, then the CRT screen.
  // screen: { bloom, noise } from the look settings.
  function makeScreenFilters(screen) {
    return [
      new PIXI.filters.AdvancedBloomFilter(Object.assign({}, screen.bloom)),
      new PIXI.filters.RGBSplitFilter(JSON.parse(JSON.stringify(SCREEN.rgbSplit))),
      new PIXI.filters.CRTFilter(Object.assign({}, SCREEN.crt, screen.crt, { noise: screen.noise }))
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
  async function applyScreenPixi(canvas, screen) {
    var app = await getScreenRenderer();
    var width = canvas.get('width');
    var height = canvas.get('height');
    var area = new PIXI.Rectangle(0, 0, width, height);

    app.renderer.resize(width, height);
    // A fresh copy with skipCache, so PixiJS never reuses an older texture.
    var sprite = new PIXI.Sprite(PIXI.Texture.from(copyCanvas(canvas.getCanvas()), true));
    var filters = makeScreenFilters(screen);
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
   * options: { resolution, colors, dither, look: { glow, fogAmount, fogColor, color, brightness, softness, tint, grain } }
   * Order: color and brightness, fog, tint, PS2 screen (with softness), screen effects
   * (pixi-filters, or the canvas versions without WebGL), ordered pattern (if chosen),
   * palette reduction, export.
   * Palette reduction must come last, or canvas-plus turns the image back into full color.
   */
  async function processImage(resized, options) {
    if (!RESOLUTION[options.resolution]) fail('Unknown resolution: ' + options.resolution);
    if (PALETTE_SIZES.indexOf(options.colors) === -1) fail('Unknown palette size: ' + options.colors);
    var dither = options.dither || 'off';
    if (DITHER_MODES.indexOf(dither) === -1) fail('Unknown dithering: ' + options.dither);
    var look = lookSettings(options.look || LOOK_PRESETS.clean);
    var screen = { bloom: look.bloom, noise: look.noise, crt: look.crt };

    var timings = {};
    var start = now();
    var canvas = resized.clone();
    checkStep(resized, 'Copy');

    var t = now();
    canvas.adjust(look.adjust);
    checkStep(canvas, 'Color adjustment');
    timings.colors = now() - t;

    t = now();
    applyFog(canvas, look.fog);
    applyTint(canvas, look.tint);
    applyScreenFrame(canvas, options.resolution, look.softScale);
    timings.depth = now() - t;

    // The full-color image before screen effects, for the animated preview.
    var prepared = copyCanvas(canvas.getCanvas());

    t = now();
    var renderer = 'canvas';
    if (pixiAvailable()) {
      try {
        await applyScreenPixi(canvas, screen);
        renderer = 'pixi';
      } catch (err) {
        screenFailed = true;
      }
    }
    if (renderer === 'canvas') {
      applyBloom(canvas, look.fallbackBloom);
      applyCrt(canvas, look.noise, look.fallbackCrt);
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
      screen: screen,
      renderer: renderer,
      timings: timings
    };
  }

  window.PhotoProcessor = {
    LIMITS: LIMITS,
    RESOLUTION: RESOLUTION,
    PALETTE_SIZES: PALETTE_SIZES,
    LOOK_PRESETS: LOOK_PRESETS,
    LOOK_KEYS: LOOK_KEYS,
    DITHER_MODES: DITHER_MODES,
    ORDERED: ORDERED,
    makeScreenFilters: makeScreenFilters,
    usesGpu: usesGpu,
    checkFile: checkFile,
    loadImage: loadImage,
    resizeImage: resizeImage,
    processImage: processImage
  };
})();
