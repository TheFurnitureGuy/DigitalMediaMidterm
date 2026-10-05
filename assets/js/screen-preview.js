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

  // Prepares the preview for a new image. Rejects if WebGL isn't available.
  async function load(source, label) {
    await ensureApp();
    clearSprite();
    var width = source.width;
    var height = source.height;
    app.renderer.resize(width, height);

    var copy = document.createElement('canvas');
    copy.width = width;
    copy.height = height;
    copy.getContext('2d').drawImage(source, 0, 0);

    var filters = PhotoProcessor.makeScreenFilters();
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

  window.ScreenPreview = {
    supported: supported,
    load: load,
    start: start,
    stop: stop,
    clear: clear
  };
})();
