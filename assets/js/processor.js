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
   * Order: triangles, color preset, palette reduction (with optional dithering), export.
   * Palette reduction must come last, or canvas-plus turns the image back into full color.
   */
  async function processImage(resized, options) {
    var vertexCount = POLYGON_DETAIL[options.polygonDetail];
    if (!vertexCount) fail('Unknown polygon detail: ' + options.polygonDetail);
    if (PALETTE_SIZES.indexOf(options.colors) === -1) fail('Unknown palette size: ' + options.colors);

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

    t = now();
    canvas.quantize({ colors: options.colors, dither: !!options.dither, ditherType: 'FloydSteinberg' });
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
      timings: timings
    };
  }

  window.PhotoProcessor = {
    LIMITS: LIMITS,
    RESOLUTION: RESOLUTION,
    POLYGON_DETAIL: POLYGON_DETAIL,
    BLEND: BLEND,
    PALETTE_SIZES: PALETTE_SIZES,
    PRESET: PRESET,
    checkFile: checkFile,
    loadImage: loadImage,
    resizeImage: resizeImage,
    processImage: processImage
  };
})();
