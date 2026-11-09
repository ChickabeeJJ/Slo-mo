'use strict';
/* =========================================================================
   Icons (24x24, currentColor). Any element with data-icon="name" is filled
   in by Icons.hydrate().
   ========================================================================= */

const Icons = (() => {
  const S = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
  const F = 'fill="currentColor"';
  const P = {
    heart: `<path d="M12 20.5S3.5 15 3.5 9A4.5 4.5 0 0 1 12 6.6 4.5 4.5 0 0 1 20.5 9c0 6-8.5 11.5-8.5 11.5z" ${F}/>`,
    star: `<path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" ${F}/>`,
    coin: `<circle cx="12" cy="12" r="9" ${F}/><circle cx="12" cy="12" r="6" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1.6"/><path d="M12 8v8" stroke="rgba(0,0,0,.3)" stroke-width="2.2" stroke-linecap="round"/>`,
    flip: `<path d="M4.6 13.2A7.5 7.5 0 1 0 7 6.6" ${S}/><path d="M7.6 2.6 7 6.8l4.2.6" ${S}/><circle cx="12" cy="12.6" r="1.9" ${F}/>`,
    pause: `<path d="M8.5 5v14M15.5 5v14" ${S} stroke-width="3.4"/>`,
    play: `<path d="M7 4.5v15l12.5-7.5z" ${F}/>`,
    back: `<path d="M15 5l-7 7 7 7" ${S} stroke-width="3"/>`,
    next: `<path d="M9 5l7 7-7 7" ${S} stroke-width="3"/>`,
    gear: `<path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z" ${S}/><path d="M10.3 2.8h3.4l.6 2.6 2 1.1 2.5-.9 1.7 2.9-1.9 1.8v2.3l1.9 1.8-1.7 2.9-2.5-.9-2 1.1-.6 2.6h-3.4l-.6-2.6-2-1.1-2.5.9-1.7-2.9 1.9-1.8v-2.3L3.5 8.5l1.7-2.9 2.5.9 2-1.1z" ${S} stroke-width="1.9"/>`,
    infinity: `<path d="M12 12c-2-2.6-3.5-4-5.5-4a4 4 0 0 0 0 8c2 0 3.5-1.4 5.5-4zm0 0c2 2.6 3.5 4 5.5 4a4 4 0 0 0 0-8c-2 0-3.5 1.4-5.5 4z" ${S} stroke-width="2.6"/>`,
    grid: `<rect x="3.5" y="3.5" width="7" height="7" rx="1.5" ${F}/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" ${F}/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" ${F}/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" ${F} opacity=".45"/>`,
    gun: `<path d="M2.5 7.5h17l1.5 1.5v3h-10l-1.3 7.5H5.2l1.3-7.5h-4z" ${F}/><path d="M11 12l.8 2.6h2.4" ${S} stroke-width="1.6"/>`,
    scroll: `<path d="M6 3.5h11a2 2 0 0 1 2 2V18a2.5 2.5 0 0 1-2.5 2.5H7.5A2.5 2.5 0 0 1 5 18V5.5" ${F}/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5" stroke="rgba(0,0,0,.35)" stroke-width="1.8" stroke-linecap="round"/>`,
    gift: `<rect x="3.5" y="9" width="17" height="11.5" rx="2" ${F}/><rect x="2.5" y="6.5" width="19" height="4" rx="1.4" ${F}/><path d="M12 6.5v14" stroke="rgba(0,0,0,.35)" stroke-width="2"/><path d="M12 6.5C10 3 6.5 3.5 7.5 5.5c.6 1.1 3 1 4.5 1zM12 6.5c2-3.5 5.5-3 4.5-1-.6 1.1-3 1-4.5 1z" ${S} stroke-width="1.8"/>`,
    lock: `<rect x="5" y="10.5" width="14" height="10" rx="2.4" ${F}/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.4"/>`,
    check: `<path d="M4.5 12.5l5 5 10-11" ${S} stroke-width="3"/>`,
    up: `<path d="M12 19V6M6 11.5 12 5.5l6 6" ${S} stroke-width="3"/>`,
    slide: `<circle cx="17.5" cy="6.5" r="2.6" ${F}/><path d="M15 9.5 9 13l-6 1.5M9 13l3 5h7" ${S} stroke-width="2.6"/><path d="M2 21h20" ${S} stroke-width="1.6" opacity=".6"/>`,
    reload: `<path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5M19.5 4v4.5H15" ${S} stroke-width="2.6"/>`,
    restart: `<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4v4.5H9" ${S} stroke-width="2.6"/>`,
    home: `<path d="M3 11.2 12 3.5l9 7.7V20.5H14.5v-6h-5v6H3z" ${F}/>`,
    clock: `<circle cx="12" cy="12" r="9" ${S} stroke-width="2.4"/><path d="M12 7v5.5l3.5 2" ${S} stroke-width="2.4"/>`,
    skull: `<path d="M12 3a8 8 0 0 0-8 8c0 2.6 1.3 4.2 3 5.3V20h10v-3.7c1.7-1.1 3-2.7 3-5.3a8 8 0 0 0-8-8z" ${F}/><circle cx="8.8" cy="11.5" r="2" fill="#1a1424"/><circle cx="15.2" cy="11.5" r="2" fill="#1a1424"/>`,
    target: `<circle cx="12" cy="12" r="8.5" ${S}/><circle cx="12" cy="12" r="3.5" ${F}/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" ${S} stroke-width="2"/>`,
    fire: `<path d="M12 2.5c1 3.5 5.5 5.5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.5 1.2-4 2.5-5 0 2 1 3 2 3.2C10.5 8 11 5 12 2.5z" ${F}/>`,
    shirt: `<path d="M8.5 3.5 3 6.5l2 4.5 2-1V20.5h10V10l2 1 2-4.5-5.5-3a3.5 3.5 0 0 1-7 0z" ${F}/>`,
    hat: `<path d="M5 15.5c0-6 3-10 7-10s7 4 7 10z" ${F}/><path d="M2.5 16.5h19" ${S} stroke-width="2.8"/>`,
    sound: `<path d="M4 9h4l5-4.5v15L8 15H4z" ${F}/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" ${S} stroke-width="2"/>`,
    music: `<path d="M9 18V5.5l11-2v12.5" ${S} stroke-width="2.4"/><circle cx="6.5" cy="18" r="2.8" ${F}/><circle cx="17.5" cy="16" r="2.8" ${F}/>`,
    shake: `<rect x="7" y="4" width="10" height="16" rx="2" ${F}/><path d="M3.5 8v8M20.5 8v8" ${S} stroke-width="2.2"/>`,
    rotate: `<rect x="3" y="7" width="18" height="10" rx="2" ${S} stroke-width="2.2"/><path d="M16 3.5c2 .2 3.6 1.4 4.3 3.2M20.5 3.5v3.3h-3.3" ${S} stroke-width="1.8"/>`,
  };
  function svg(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`; }
  function hydrate(root = document) {
    root.querySelectorAll('[data-icon]').forEach(el => {
      if (el.dataset.hydrated === el.dataset.icon) return;
      el.innerHTML = svg(el.dataset.icon);
      el.dataset.hydrated = el.dataset.icon;
    });
  }
  return { svg, hydrate };
})();
