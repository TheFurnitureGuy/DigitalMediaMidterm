/*
 * The animated TV preview for the processed image.
 * It shows the full-color image with the same pixi-filters the PNG uses,
 * with moving CRT noise. app.js decides when to show, start and stop it.
 */
(function () {
  'use strict';

  var MAX_FPS = 30;

  var app = null;
  var appReady = null;
  var failed = false;
  var sprite = null;
  var crt = null;
  var frame = null;
  var observer = null;
  var playing = false;
  var visible = true;

  function supported() {
    return !failed && typeof PIXI !== 'undefined' && !!PIXI.filters && !!window.PhotoProcessor;
  }

  function tick(ticker) {
    if (!crt) return;
    crt.time += 0.5 * ticker.deltaTime;
    crt.seed = Math.random();
  }

  // One preview renderer is created on first use and reused for every image.
  function ensureApp() {
    if (!appReady) {
      app = new PIXI.Application();
      appReady = app.init({ width: 16, height: 16, preference: 'webgl', backgroundAlpha: 1, antialias: false, autoStart: false })
        .then(function () {
          if (!PhotoProcessor.usesGpu(app)) {
            app.destroy();
            throw new Error('No WebGL or WebGPU');
          }
          app.ticker.maxFPS = MAX_FPS;
          app.ticker.add(tick);
          app.canvas.setAttribute('role', 'img');
          return app;
        })
        .catch(function (err) {
          appReady = null;
          failed = true;
          throw err;
        });
    }
    return appReady;
  }

  // Runs the animation only while it's playing and the frame is on screen.
  function update() {
    if (!app) return;
    if (playing && visible) app.ticker.start();
    else app.ticker.stop();
  }

  function watch(target) {
    if (frame === target) return;
    frame = target;
    if (!('IntersectionObserver' in window)) return;
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      update();
    });
    observer.observe(target);
  }

  function clearSprite() {
    if (!sprite) return;
    app.stage.removeChild(sprite);
    sprite.filters.forEach(function (f) { f.destroy(); });
    sprite.destroy({ texture: true, textureSource: true });
    sprite = null;
    crt = null;
  }

  // Prepares the preview for a new image, using the same glow and grain as the PNG.
  // Rejects if WebGL isn't available.
  async function load(source, label, screen) {
    await ensureApp();
    clearSprite();
    var width = source.width;
    var height = source.height;
    app.renderer.resize(width, height);

    var copy = document.createElement('canvas');
    copy.width = width;
    copy.height = height;
    copy.getContext('2d').drawImage(source, 0, 0);

    var filters = PhotoProcessor.makeScreenFilters(screen);
    sprite = new PIXI.Sprite(PIXI.Texture.from(copy, true));
    sprite.filters = filters;
    sprite.filterArea = new PIXI.Rectangle(0, 0, width, height);
    crt = filters[2];
    app.stage.addChild(sprite);
    app.canvas.setAttribute('aria-label', label);
    app.render();
  }

  // Puts the preview into the frame and starts the animation.
  function start(target) {
    if (!app || !sprite) return;
    target.replaceChildren(app.canvas);
    watch(target);
    playing = true;
    update();
  }

  function stop() {
    playing = false;
    update();
  }

  function clear() {
    stop();
    if (app) clearSprite();
  }

  // Draws `count` frames of the moving TV effect off screen, each with new grain and
  // scanline positions, and returns their RGBA pixels. Used by the GIF download.
  function captureFrames(count) {
    if (!app || !sprite || !crt) throw new Error('The moving preview is not ready.');
    var width = app.renderer.width;
    var height = app.renderer.height;
    var area = new PIXI.Rectangle(0, 0, width, height);
    var savedTime = crt.time;
    var frames = [];
    try {
      for (var i = 0; i < count; i++) {
        crt.time = savedTime + i * 1.5;
        crt.seed = Math.random();
        app.render();
        var canvas = app.renderer.extract.canvas({ target: app.stage, frame: area });
        var ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        ctx.canvas.width = width;
        ctx.canvas.height = height;
        ctx.drawImage(canvas, 0, 0);
        frames.push(ctx.getImageData(0, 0, width, height).data);
      }
    } finally {
      crt.time = savedTime;
      app.render();
    }
    return { width: width, height: height, frames: frames };
  }

  window.ScreenPreview = {
    supported: supported,
    load: load,
    start: start,
    stop: stop,
    clear: clear,
    captureFrames: captureFrames
  };
})();
