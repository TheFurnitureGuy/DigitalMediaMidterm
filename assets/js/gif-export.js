/*
 * The GIF download. It captures a short loop of the moving TV preview and maps every
 * frame to the same palette and dithering as the PNG, so the GIF shows the same colors.
 * The GIF encoder (gifenc) loads only the first time someone asks for a GIF.
 */
(function () {
  'use strict';

  var FRAMES = 15;    // a 1-second loop
  var DELAY_MS = 70;  // GIF delays are stored in hundredths of a second

  var scriptUrl = document.currentScript && document.currentScript.src;
  var encoderReady = null;

  function loadEncoder() {
    if (!encoderReady) {
      encoderReady = import(new URL('vendor/gifenc.esm.js', scriptUrl).href).catch(function (err) {
        encoderReady = null;
        throw err;
      });
    }
    return encoderReady;
  }

  // Finds the closest palette color, remembering answers for colors it has seen.
  function makeNearest(palette) {
    var cache = new Map();
    return function (r, g, b) {
      var key = (r << 16) | (g << 8) | b;
      var hit = cache.get(key);
      if (hit !== undefined) return hit;
      var best = 0;
      var bestDist = Infinity;
      for (var i = 0; i < palette.length; i++) {
        var c = palette[i];
        var dr = r - c[0];
        var dg = g - c[1];
        var db = b - c[2];
        var dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      cache.set(key, best);
      return best;
    };
  }

  function mapNearest(data, nearest) {
    var count = data.length / 4;
    var index = new Uint8Array(count);
    for (var p = 0; p < count; p++) {
      index[p] = nearest(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
    }
    return index;
  }

  // Floyd-Steinberg against a fixed palette: each pixel's rounding error is passed on
  // to the pixels to its right and below.
  function mapDiffusion(data, width, height, palette, nearest) {
    var work = new Float32Array(width * height * 3);
    for (var p = 0; p < width * height; p++) {
      work[p * 3] = data[p * 4];
      work[p * 3 + 1] = data[p * 4 + 1];
      work[p * 3 + 2] = data[p * 4 + 2];
    }
    var index = new Uint8Array(width * height);
    function spread(x, y, er, eg, eb, weight) {
      if (x < 0 || x >= width || y >= height) return;
      var j = (y * width + x) * 3;
      work[j] += er * weight;
      work[j + 1] += eg * weight;
      work[j + 2] += eb * weight;
    }
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var i = (y * width + x) * 3;
        var r = Math.max(0, Math.min(255, Math.round(work[i])));
        var g = Math.max(0, Math.min(255, Math.round(work[i + 1])));
        var b = Math.max(0, Math.min(255, Math.round(work[i + 2])));
        var k = nearest(r, g, b);
        var c = palette[k];
        index[y * width + x] = k;
        var er = work[i] - c[0];
        var eg = work[i + 1] - c[1];
        var eb = work[i + 2] - c[2];
        spread(x + 1, y, er, eg, eb, 7 / 16);
        spread(x - 1, y + 1, er, eg, eb, 3 / 16);
        spread(x, y + 1, er, eg, eb, 5 / 16);
        spread(x + 1, y + 1, er, eg, eb, 1 / 16);
      }
    }
    return index;
  }

  /*
   * Builds the GIF and returns it as a Blob.
   * options: { palette: [{r, g, b}], colors, dither: 'off' | 'diffusion' | 'ordered' }
   */
  async function makeGif(options) {
    var gifenc = await loadEncoder();
    var capture = ScreenPreview.captureFrames(FRAMES);
    var width = capture.width;
    var height = capture.height;

    var palette = options.palette.map(function (c) { return [c.r, c.g, c.b]; });
    var table = palette.slice();
    // A GIF color table must hold a power of two colors, at least two.
    var size = 2;
    while (size < table.length) size *= 2;
    while (table.length < size) table.push([0, 0, 0]);

    var nearest = makeNearest(palette);
    var gif = gifenc.GIFEncoder();
    capture.frames.forEach(function (data, n) {
      var index;
      if (options.dither === 'ordered') {
        PhotoProcessor.orderPixels(data, width, height, options.colors);
        index = mapNearest(data, nearest);
      } else if (options.dither === 'diffusion') {
        index = mapDiffusion(data, width, height, palette, nearest);
      } else {
        index = mapNearest(data, nearest);
      }
      gif.writeFrame(index, width, height, { palette: table, delay: DELAY_MS, repeat: n === 0 ? 0 : undefined });
    });
    gif.finish();
    return new Blob([gif.bytes()], { type: 'image/gif' });
  }

  window.GifExport = { makeGif: makeGif };
})();
