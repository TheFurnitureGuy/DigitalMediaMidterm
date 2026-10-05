/*
 * Scroll reveal for the sections below the lab. A section marked data-reveal fades in
 * when it scrolls into view and fades out again when the visitor scrolls back above it.
 * Hidden sections stay in the page, so screen readers and Find still reach them.
 * Without JavaScript or with reduced motion turned on, everything simply shows.
 */
(function () {
  'use strict';

  var sections = document.querySelectorAll('[data-reveal]');
  if (!sections.length || !('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.documentElement.classList.add('reveal-on');

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
      } else if (entry.boundingClientRect.top > 0) {
        // The section is below the screen again, so the visitor scrolled back up.
        entry.target.classList.remove('is-revealed');
      }
    });
  }, { rootMargin: '0px 0px -12% 0px' });

  sections.forEach(function (section) {
    observer.observe(section);
    // Tabbing into a section shows it right away.
    section.addEventListener('focusin', function () {
      section.classList.add('is-revealed');
    });
  });
})();
