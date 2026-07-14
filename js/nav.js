/* Customer navigation: hamburger-toggled left drawer.
 * Pages include a button#nav-toggle in their header; this script injects
 * the drawer and backdrop. Admin is deliberately not listed — it lives at
 * its own URL (admin.html) for the snack keeper only. */
(function () {
  const here = location.pathname.split("/").pop() || "index.html";

  // A brand-new device that hasn't gone through the "Start your tab?" gate
  // (or an invite link) yet has no tab/history worth navigating to - only
  // Feedback and Privacy Policy make sense until then. Read directly (no FS
  // dependency) since nav.js runs on pages like privacy.html that don't
  // load the Firebase/data layer at all.
  const started =
    localStorage.getItem("fresh_snacks_device_started") === "1" ||
    !!localStorage.getItem("fresh_snacks_linked_to");

  const items = started
    ? [
        { label: "My tab", href: "index.html" },
        { label: "Log my snacks", href: "bins.html" },
        { label: "Invoice Me", href: "invoice.html" },
        { label: "User settings", href: "index.html#user-settings" },
        { label: "Feedback", href: "feedback.html" },
        { label: "Privacy Policy", href: "privacy.html" },
      ]
    : [
        { label: "Feedback", href: "feedback.html" },
        { label: "Privacy Policy", href: "privacy.html" },
      ];
  if (here === "invoice.html") items.push({ label: "Print / Save PDF", print: true });

  const backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";

  const drawer = document.createElement("nav");
  drawer.className = "drawer";
  drawer.setAttribute("aria-label", "Menu");

  const brand = document.createElement("div");
  brand.className = "drawer-brand";
  brand.textContent = "Fresh Snacks";
  drawer.appendChild(brand);

  const close = () => {
    drawer.classList.remove("open");
    backdrop.classList.remove("show");
  };
  const open = () => {
    drawer.classList.add("open");
    backdrop.classList.add("show");
  };

  for (const it of items) {
    let el;
    if (it.print) {
      el = document.createElement("button");
      el.type = "button";
      el.onclick = () => { close(); window.print(); };
    } else {
      el = document.createElement("a");
      el.href = it.href;
      if (it.href === here) el.classList.add("active");
      el.addEventListener("click", close); // same-page anchors don't reload
    }
    el.classList.add("drawer-link");
    el.textContent = it.label;
    drawer.appendChild(el);
  }

  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  document.body.append(backdrop, drawer);

  const toggle = document.getElementById("nav-toggle");
  if (toggle) {
    toggle.addEventListener("click", () =>
      drawer.classList.contains("open") ? close() : open());
  }
})();
