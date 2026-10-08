/*
 * A short PS2-style boot intro: blocks drift in from the dark and gather, a blue glow
 * swells, and the logo appears. It plays once per visit (per browser tab session),
 * a click or any key skips it, and it never plays with reduced motion.
 * This file loads right after <body>, so the intro covers the page before it draws.
 */
(function () {
  'use strict';

  var KEY = 'ps2lab-booted';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try {
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, '1');
  } catch (err) {
    return; // Storage blocked: skip the intro rather than replay it on every page.
  }

  // Where each block starts, as an offset from the center of the screen.
  var BLOCKS = [[-42, -30], [38, -34], [-46, 18], [44, 26], [-10, -44], [12, 42], [-30, 40], [30, -12]];

  var boot = document.createElement('div');
  boot.className = 'boot';
  boot.setAttribute('aria-hidden', 'true');
  var html = '<div class="boot__glow"></div>';
  BLOCKS.forEach(function (b, i) {
    html += '<span class="boot__block" style="--x:' + b[0] + 'vw;--y:' + b[1] + 'vh;--i:' + i + '"></span>';
  });
  html += '<div class="boot__logo">' +
    '<svg viewBox="0 0 28 28"><path class="brand__logo-front" d="M5 10.5 14 15.5v10L5 20.5z" /><path d="M14 3 23 8 14 13 5 8z M5 8v12.5l9 5 9-5V8 M14 13v12.5" /></svg>' +
    '<span>PS2-Inspired Photo Lab</span></div>';
  boot.innerHTML = html;
  document.body.appendChild(boot);

  var done = false;
  function finish() {
    if (done) return;
    done = true;
    boot.classList.add('is-leaving');
    setTimeout(function () { boot.remove(); }, 400);
    window.removeEventListener('keydown', finish);
  }

  setTimeout(finish, 2200);
  boot.addEventListener('click', finish);
  window.addEventListener('keydown', finish);
})();
