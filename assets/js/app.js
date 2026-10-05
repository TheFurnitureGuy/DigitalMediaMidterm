/*
 * Page behavior for the photo lab: choosing an image, settings, page states,
 * palette and download. The filter itself lives in processor.js.
 */
(function () {
  'use strict';

  var P = window.PhotoProcessor;

  // The two large libraries load only when someone first picks an image.
  var LIBRARIES = [
    'assets/js/vendor/canvas-plus.js',
    'assets/js/vendor/triangulate-image.min.js',
    'assets/js/vendor/pixi.min.js',
    'assets/js/vendor/pixi-filters.js'
  ];

  var SAMPLES = {
    sunset: { url: 'assets/images/sample-sunset.webp', alt: 'Sunset over an open field', name: 'sunset' },
    desert: { url: 'assets/images/sample-desert.png', alt: 'Flat-topped rock formations in a desert', name: 'desert' }
  };

  var LEVELS = { 1: 'Low', 2: 'Medium', 3: 'High' };

  var DEFAULTS = {
    polygonDetail: 2,
    resolution: 2,
    paletteIndex: P.PALETTE_SIZES.indexOf(64),
    dither: 'ordered'
  };

  var DITHER_NAMES = {
    off: 'no dithering',
    diffusion: 'error diffusion dithering',
    ordered: 'ordered dithering'
  };

  var MESSAGES = {
    opening: 'Opening your image…',
    applying: 'Applying your settings',
    ready: 'Your image is ready.',
    changed: 'Apply changes to update the preview.',
    failed: 'We couldn’t process this image. Try a smaller JPG, PNG or WebP, or choose a sample.',
    trySample: 'You can also try a sample.',
    noTools: 'The image tools didn’t load. Check your connection and try again.'
  };

  var el = {
    upload: document.getElementById('upload-input'),
    uploadLabel: document.getElementById('upload-input').closest('label'),
    sunset: document.getElementById('sample-sunset'),
    desert: document.getElementById('sample-desert'),
    originalFrame: document.getElementById('original-frame'),
    processedFrame: document.getElementById('processed-frame'),
    status: document.getElementById('status'),
    polygon: document.getElementById('polygon-detail'),
    polygonValue: document.getElementById('polygon-detail-value'),
    resolution: document.getElementById('output-resolution'),
    resolutionValue: document.getElementById('output-resolution-value'),
    palette: document.getElementById('palette-size'),
    paletteValue: document.getElementById('palette-size-value'),
    ditherInputs: document.querySelectorAll('input[name="dithering"]'),
    apply: document.getElementById('apply'),
    reset: document.getElementById('reset'),
    download: document.getElementById('download'),
    paletteCount: document.getElementById('palette-count'),
    swatches: document.getElementById('palette-swatches'),
    readout: document.getElementById('palette-readout'),
    motionControls: document.getElementById('motion-controls'),
    motionToggle: document.getElementById('motion-toggle')
  };

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var state = {
    image: null,        // full-size CanvasPlus image
    name: '',           // short name used in alt text
    resized: {},        // resized copies, keyed by resolution
    applied: null,      // settings used for the current result
    result: null,       // { url, colors } of the current result
    originalUrl: null,  // object URL of an uploaded photo's preview
    palette: [],
    busy: false,
    motion: {
      available: false,  // the animated preview is ready for the current result
      playing: false,
      userPaused: false  // remembered, so a new result doesn't restart motion
    }
  };

  /* Loading the libraries */

  var librariesLoading = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function loadLibraries() {
    if (!librariesLoading) {
      librariesLoading = LIBRARIES.reduce(function (chain, src) {
        return chain.then(function () { return loadScript(src); });
      }, Promise.resolve()).catch(function () {
        librariesLoading = null;
        throw new Error(MESSAGES.noTools);
      });
    }
    return librariesLoading;
  }

  // Waits until the browser has drawn the latest status text.
  function nextPaint() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
  }

  /* Settings */

  function readSettings() {
    return {
      polygonDetail: Number(el.polygon.value),
      resolution: Number(el.resolution.value),
      paletteIndex: Number(el.palette.value),
      dither: document.querySelector('input[name="dithering"]:checked').value
    };
  }

  function sameSettings(a, b) {
    return !!a && !!b &&
      a.polygonDetail === b.polygonDetail &&
      a.resolution === b.resolution &&
      a.paletteIndex === b.paletteIndex &&
      a.dither === b.dither;
  }

  function setDither(mode) {
    el.ditherInputs.forEach(function (input) {
      input.checked = input.value === mode;
    });
  }

  function updateLabels() {
    var s = readSettings();
    var colors = P.PALETTE_SIZES[s.paletteIndex] + ' colors';
    el.polygonValue.textContent = LEVELS[s.polygonDetail];
    el.polygon.setAttribute('aria-valuetext', LEVELS[s.polygonDetail]);
    el.resolutionValue.textContent = LEVELS[s.resolution];
    el.resolution.setAttribute('aria-valuetext', LEVELS[s.resolution]);
    el.paletteValue.textContent = colors;
    el.palette.setAttribute('aria-valuetext', colors);
  }

  function writeSettings(s) {
    el.polygon.value = s.polygonDetail;
    el.resolution.value = s.resolution;
    el.palette.value = s.paletteIndex;
    setDither(s.dither);
    updateLabels();
  }

  /* Page state */

  function setStatus(text) {
    el.status.textContent = text;
  }

  function updateButtons() {
    var hasImage = !!state.image;
    var resultMatches = !!state.result && sameSettings(readSettings(), state.applied);

    el.apply.disabled = state.busy || !hasImage;
    el.reset.disabled = state.busy || !hasImage;
    el.download.disabled = state.busy || !resultMatches;
    el.sunset.disabled = state.busy;
    el.desert.disabled = state.busy;
    el.upload.disabled = state.busy;
    el.uploadLabel.classList.toggle('is-disabled', state.busy);
    el.motionToggle.disabled = state.busy;
  }

  function onSettingsChange() {
    updateLabels();
    if (state.image && state.result && !state.busy) {
      setStatus(sameSettings(readSettings(), state.applied) ? MESSAGES.ready : MESSAGES.changed);
    }
    updateButtons();
  }

  /* Previews */

  function showPlaceholder(frame) {
    var p = document.createElement('p');
    p.className = 'preview__empty';
    p.textContent = 'No image yet';
    frame.replaceChildren(p);
  }

  function showImage(frame, src, alt, pixelated) {
    var img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    if (pixelated) img.className = 'is-pixelated';
    frame.replaceChildren(img);
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('Preview failed'));
      }, 'image/jpeg', 0.9);
    });
  }

  // Resized copies are kept so Apply doesn't resize again unless the resolution changes.
  function getResized(resolution) {
    if (!state.resized[resolution]) {
      state.resized[resolution] = P.resizeImage(state.image, resolution);
    }
    return state.resized[resolution];
  }

  /* Palette */

  function clearPalette() {
    state.palette = [];
    el.paletteCount.textContent = '';
    el.readout.textContent = '';
    el.swatches.classList.remove('has-colors');
    el.swatches.removeAttribute('role');
    el.swatches.removeAttribute('aria-label');
    var p = document.createElement('p');
    p.className = 'palette__empty';
    p.textContent = 'Your palette will appear here after processing.';
    el.swatches.replaceChildren(p);
  }

  function toHex(c) {
    return '#' + [c.r, c.g, c.b].map(function (v) {
      return v.toString(16).padStart(2, '0');
    }).join('').toUpperCase();
  }

  function describeColor(c, index) {
    return 'Color ' + (index + 1) + ': red ' + c.r + ', green ' + c.g + ', blue ' + c.b;
  }

  function renderPalette(palette, maxColors) {
    state.palette = palette;
    el.paletteCount.textContent = 'Using ' + palette.length + ' of ' + maxColors + ' colors.';
    el.readout.textContent = '';
    el.swatches.classList.add('has-colors');
    el.swatches.setAttribute('role', 'group');
    el.swatches.setAttribute('aria-label', 'Palette colors');

    var fragment = document.createDocumentFragment();
    palette.forEach(function (c, i) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'palette__swatch';
      button.style.backgroundColor = 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
      button.setAttribute('aria-label', describeColor(c, i));
      button.setAttribute('aria-pressed', 'false');
      button.tabIndex = i === 0 ? 0 : -1;
      button.dataset.index = i;
      fragment.appendChild(button);
    });
    el.swatches.replaceChildren(fragment);
  }

  function selectSwatch(index) {
    var buttons = el.swatches.querySelectorAll('.palette__swatch');
    buttons.forEach(function (b, i) {
      b.setAttribute('aria-pressed', i === index ? 'true' : 'false');
    });
    var c = state.palette[index];
    el.readout.textContent = describeColor(c, index) + ' (' + toHex(c) + ')';
  }

  // Only one swatch is in the Tab order. Arrow keys, Home and End move between them.
  function moveSwatchFocus(event) {
    var buttons = Array.prototype.slice.call(el.swatches.querySelectorAll('.palette__swatch'));
    var current = buttons.indexOf(document.activeElement);
    if (current === -1) return;

    var next = current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(current + 1, buttons.length - 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(current - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;

    event.preventDefault();
    buttons[current].tabIndex = -1;
    buttons[next].tabIndex = 0;
    buttons[next].focus();
  }

  /* Result */

  /* Animated preview */

  function updateMotionControls() {
    el.motionControls.hidden = !state.motion.available;
    el.motionToggle.textContent = state.motion.playing ? 'Pause TV effect' : 'Play TV effect';
  }

  // Playing shows the moving full-color preview. Paused shows the exact PNG you download.
  function setMotion(play) {
    state.motion.playing = play;
    if (play) {
      ScreenPreview.start(el.processedFrame);
    } else {
      if (state.motion.available) ScreenPreview.stop();
      showImage(el.processedFrame, state.result.url, state.result.label, false);
    }
    updateMotionControls();
  }

  async function showResult(prepared) {
    state.motion.available = false;
    if (window.ScreenPreview && ScreenPreview.supported()) {
      try {
        await ScreenPreview.load(prepared, state.result.label + ', with a moving TV effect in full color');
        state.motion.available = true;
      } catch (err) {
        state.motion.available = false;
      }
    }
    setMotion(state.motion.available && !state.motion.userPaused && !reducedMotion.matches);
  }

  function onMotionToggle() {
    if (!state.result || !state.motion.available) return;
    state.motion.userPaused = state.motion.playing;
    setMotion(!state.motion.playing);
  }

  function clearResult() {
    if (window.ScreenPreview) ScreenPreview.clear();
    state.motion.available = false;
    state.motion.playing = false;
    updateMotionControls();
    if (state.result) URL.revokeObjectURL(state.result.url);
    state.result = null;
    state.applied = null;
    showPlaceholder(el.processedFrame);
    clearPalette();
  }

  async function applySettings() {
    if (state.busy || !state.image) return;
    var settings = readSettings();
    var colors = P.PALETTE_SIZES[settings.paletteIndex];

    state.busy = true;
    updateButtons();
    setStatus(MESSAGES.applying);
    el.processedFrame.setAttribute('aria-busy', 'true');
    await nextPaint();

    try {
      var result = await P.processImage(getResized(settings.resolution), {
        polygonDetail: settings.polygonDetail,
        colors: colors,
        dither: settings.dither
      });
      clearResult();
      state.result = {
        url: URL.createObjectURL(result.blob),
        colors: colors,
        label: 'Processed ' + state.name + ', ' + colors + ' colors, ' + DITHER_NAMES[settings.dither]
      };
      state.applied = settings;
      await showResult(result.prepared);
      renderPalette(result.palette, colors);
      setStatus(MESSAGES.ready);
    } catch (err) {
      clearResult();
      setStatus(MESSAGES.failed);
    } finally {
      state.busy = false;
      el.processedFrame.removeAttribute('aria-busy');
      updateButtons();
    }
  }

  /* Choosing an image */

  async function chooseImage(source, info) {
    if (state.busy) return;
    state.busy = true;
    updateButtons();
    setStatus(MESSAGES.opening);

    try {
      await loadLibraries();
      var image = await P.loadImage(source);

      // The new image loaded, so it can replace the current one.
      state.image = image;
      state.name = info.name;
      state.resized = {};
      clearResult();
      if (state.originalUrl) {
        URL.revokeObjectURL(state.originalUrl);
        state.originalUrl = null;
      }

      if (info.url) {
        showImage(el.originalFrame, info.url, info.alt, false);
      } else {
        // Uploads are previewed from the High copy, not the full-size file.
        var preview = await canvasToBlob(getResized(3).getCanvas());
        state.originalUrl = URL.createObjectURL(preview);
        showImage(el.originalFrame, state.originalUrl, info.alt, false);
      }
      writeSettings(DEFAULTS);
    } catch (err) {
      state.busy = false;
      updateButtons();
      setStatus(err.message === MESSAGES.noTools ? err.message : err.message + ' ' + MESSAGES.trySample);
      return;
    }

    state.busy = false;
    await applySettings();
  }

  function onUpload() {
    var file = el.upload.files[0];
    el.upload.value = '';
    if (!file) return;

    var problem = P.checkFile(file);
    if (problem) {
      setStatus(problem + ' ' + MESSAGES.trySample);
      return;
    }
    chooseImage(file, { name: 'photo', alt: 'Your uploaded photo' });
  }

  function onDownload() {
    if (!state.result || el.download.disabled) return;
    var link = document.createElement('a');
    link.href = state.result.url;
    link.download = 'ps2-photo-lab.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  /* Events */

  el.upload.addEventListener('change', onUpload);
  el.sunset.addEventListener('click', function () { chooseImage(SAMPLES.sunset.url, SAMPLES.sunset); });
  el.desert.addEventListener('click', function () { chooseImage(SAMPLES.desert.url, SAMPLES.desert); });

  [el.polygon, el.resolution, el.palette].forEach(function (input) {
    input.addEventListener('input', onSettingsChange);
  });
  el.ditherInputs.forEach(function (input) {
    input.addEventListener('change', onSettingsChange);
  });

  el.apply.addEventListener('click', applySettings);
  el.reset.addEventListener('click', function () {
    writeSettings(DEFAULTS);
    onSettingsChange();
  });
  el.download.addEventListener('click', onDownload);
  el.motionToggle.addEventListener('click', onMotionToggle);

  el.swatches.addEventListener('click', function (event) {
    var button = event.target.closest('.palette__swatch');
    if (button) selectSwatch(Number(button.dataset.index));
  });
  el.swatches.addEventListener('keydown', moveSwatchFocus);

  updateLabels();
  updateButtons();
})();
