/* Customer navigation: hamburger-toggled left drawer.
 * Pages include a button#nav-toggle in their header; this script injects
 * the drawer and backdrop. Admin is deliberately not listed — it lives at
 * its own URL (admin.html) for the snack keeper only. */
(function () {
  const here = location.pathname.split("/").pop() || "index.html";
  const items = [
    { label: "My tab", href: "index.html" },
    { label: "Log my snacks", href: "bins.html" },
    { label: "Invoice", href: "invoice.html" },
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
