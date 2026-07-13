/* Shared top banner (badge, video backdrop, tagline, track line, pill,
 * menu + profile controls). Injected into <header class="banner" id="site-banner">
 * so every page shares one copy instead of duplicating the markup.
 *
 * Load order matters: this script must run before js/nav.js (which wires
 * up #nav-toggle) and before any page-specific script that references
 * #profile-toggle (e.g. index.html's own settings-drawer wiring). The
 * profile button is a plain link to index.html#user-settings by default;
 * index.html intercepts its click to open the drawer in place instead of
 * navigating, since it's already there. */
(function () {
  const mount = document.getElementById("site-banner");
  if (!mount) return;

  mount.innerHTML = `
    <svg class="banner-bg" viewBox="0 0 1200 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="bnr-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2c6e3f"/>
          <stop offset="0.55" stop-color="#1d5c31"/>
          <stop offset="1" stop-color="#174f29"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="260" fill="url(#bnr-g)"/>
      <path d="M0,185 C220,135 420,240 640,190 C860,140 1020,225 1200,170 L1200,260 L0,260 Z" fill="#2f7a44" opacity="0.5"/>
      <path d="M420,260 C560,205 760,250 900,215 C1030,185 1130,225 1200,205 L1200,260 Z" fill="#6fae3d" opacity="0.55"/>
      <path d="M900,260 C960,195 1090,180 1200,208 L1200,260 Z" fill="#a9cf3e" opacity="0.9"/>
      <g fill="#3e8a4e" opacity="0.95">
        <ellipse cx="52" cy="228" rx="36" ry="13" transform="rotate(-28 52 228)"/>
        <ellipse cx="86" cy="243" rx="32" ry="12" transform="rotate(-6 86 243)"/>
        <ellipse cx="36" cy="250" rx="26" ry="10" transform="rotate(-48 36 250)"/>
      </g>
      <g fill="#cfe98a" opacity="0.75">
        <circle cx="520" cy="42" r="4"/><circle cx="602" cy="92" r="3"/>
        <circle cx="700" cy="30" r="5" fill="#f5d76e"/><circle cx="762" cy="122" r="3"/>
        <circle cx="862" cy="52" r="4" fill="#eaf5e8"/><circle cx="932" cy="102" r="3" fill="#f5d76e"/>
        <circle cx="1050" cy="60" r="4"/><circle cx="1120" cy="120" r="3" fill="#eaf5e8"/>
        <ellipse cx="670" cy="62" rx="7" ry="3" fill="#e9f7c0" transform="rotate(30 670 62)"/>
        <ellipse cx="822" cy="86" rx="6" ry="3" fill="#e9f7c0" transform="rotate(-20 822 86)"/>
        <ellipse cx="990" cy="95" rx="6" ry="3" fill="#e9f7c0" transform="rotate(15 990 95)"/>
      </g>
    </svg>
    <video class="banner-bg banner-video" src="fresh-snacks-banner.mp4" autoplay muted loop playsinline preload="auto" aria-hidden="true"></video>
    <div class="banner-shade" aria-hidden="true"></div>
    <div class="banner-inner">
      <button class="hamburger banner-menu" id="nav-toggle" aria-label="Open menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
      </button>
      <img class="banner-badge" src="banner-logo.png" alt="Fresh Snacks" />
      <div class="banner-main">
        <div class="banner-tagline"><span class="tick">&#8779;</span> Snack smart, live fresh! <span class="tick">&#8779;</span></div>
        <div class="banner-subrow">
          <span class="banner-track"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10.5V4a1 1 0 0 0-1-1h-6.5a1 1 0 0 0-.71.29l-8 8a1 1 0 0 0 0 1.42l7 7a1 1 0 0 0 1.42 0l8-8a1 1 0 0 0 .29-.71Z"/><circle cx="15.5" cy="7.5" r="1.4" fill="currentColor" stroke="none"/></svg></span> Track your purchases, payments, and running balance</span>
          <span class="banner-pill"><svg viewBox="0 0 24 24" fill="#f5b400"><path d="M12 2l2.9 6.26L21.8 9l-5 4.87L18.2 21 12 17.3 5.8 21l1.4-7.13-5-4.87 6.9-.74L12 2z"/></svg> Happy snacking!</span>
        </div>
      </div>
      <a class="hamburger profile-btn banner-profile" id="profile-toggle" href="index.html#user-settings" aria-label="Open user settings" title="User settings">
        <img src="profile-icon.png" alt="" />
        <span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
      </a>
    </div>`;
})();
