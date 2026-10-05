/*
 * Scroll reveal. A section marked data-reveal opens like a PS2 menu window
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

  // Decide from the section's full size. The opening animation clips the section to a
  // thin line, and the observer only counts that line, which used to make the section
  // flip between shown and hidden when it sat near the bottom of the screen.
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var box = entry.boundingClientRect;
      var root = entry.rootBounds;
      if (!root) return;
      if (box.top < root.bottom && box.bottom > root.top) {
        entry.target.classList.add('is-revealed');
      } else if (box.top >= root.bottom && !atEnd()) {
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

  // At the end of the page, a short section can sit in the bottom strip the observer
  // ignores, so reveal anything on screen once the visitor can't scroll any further.
  function atEnd() {
    return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
  }

  var queued = false;
  function revealAtEnd() {
    queued = false;
    if (!atEnd()) return;
    sections.forEach(function (section) {
      var box = section.getBoundingClientRect();
      if (box.top < window.innerHeight && box.bottom > 0) section.classList.add('is-revealed');
    });
  }
  function onScroll() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(revealAtEnd);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();
})();
