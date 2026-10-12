'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const slider = document.querySelector('.landing-slider');
  if (!slider) return;

  const slides = [...slider.querySelectorAll('.landing-slide')];
  const dots = [...slider.querySelectorAll('[data-slide-to]')];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let timer;

  function showSlide(index) {
    current = (index + slides.length) % slides.length;
    slides.forEach((slide, position) => {
      const active = position === current;
      slide.classList.toggle('is-active', active);
      slide.setAttribute('aria-hidden', String(!active));
      slide.inert = !active;
    });
    dots.forEach((dot, position) => {
      const active = position === current;
      dot.classList.toggle('active', active);
      if (active) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  }

  function stopAuto() {
    window.clearInterval(timer);
    timer = undefined;
  }

  function startAuto() {
    stopAuto();
    if (!reduceMotion.matches && !document.hidden) {
      timer = window.setInterval(() => showSlide(current + 1), 6000);
    }
  }

  slider.querySelector('[data-slide-prev]').addEventListener('click', () => { showSlide(current - 1); startAuto(); });
  slider.querySelector('[data-slide-next]').addEventListener('click', () => { showSlide(current + 1); startAuto(); });
  dots.forEach((dot, index) => dot.addEventListener('click', () => { showSlide(index); startAuto(); }));
  slider.addEventListener('mouseenter', stopAuto);
  slider.addEventListener('mouseleave', startAuto);
  slider.addEventListener('focusin', stopAuto);
  slider.addEventListener('focusout', event => { if (!slider.contains(event.relatedTarget)) startAuto(); });
  slider.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      showSlide(current + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  document.addEventListener('visibilitychange', () => document.hidden ? stopAuto() : startAuto());
  reduceMotion.addEventListener('change', startAuto);
  startAuto();
});
