/* Customer navigation: hamburger-toggled left drawer.
 * Pages include a button#nav-toggle in their header; this script injects
 * the drawer and backdrop. Signed-in administrators additionally get an
 * "Administration" section linking to admin.html - every admin-only page
 * already links back to each other directly, so this only affects the
 * customer-facing drawer itself. */
(function () {
  const here = location.pathname.split("/").pop() || "index.html";
  const activeProfileKey = "fresh_snacks_profile_active";
  let activeProfileState = false;
  let activeAdminState = false;

  // These synchronous markers keep the full profile menu stable while a new
  // page restores Firebase. The verified marker below also covers older
  // active profiles that predate fresh_snacks_device_started.
  const hasTabMarker = () =>
    localStorage.getItem("fresh_snacks_device_started") === "1" ||
    !!localStorage.getItem("fresh_snacks_linked_to");
  const hasLocalProfileMarker = () =>
    hasTabMarker() ||
    localStorage.getItem(activeProfileKey) === "1";

  const adminGroup = { section: "Administration", items: [
    { label: "Admin dashboard", href: "admin.html" },
  ] };
  const profileGroups = [
    { section: "Your tab", items: [
      { label: "My tab", href: "index.html" },
      { label: "Your balance", href: "index.html#activity-summary" },
      { label: "Transaction history", href: "index.html#snack-log" },
      { label: "Log my snacks", href: "index.html#snack-shop" },
      { label: "Invoice Me", href: "invoice.html" },
    ] },
    { section: "Account", items: [
      { label: "User settings", href: "index.html#user-settings" },
      { label: "Tell a friend", href: "index.html#tell-a-friend" },
    ] },
    { section: "Support", items: [
      { label: "Feedback", href: "feedback.html" },
      { label: "Privacy Policy", href: "privacy.html" },
    ] },
  ];
  const guestGroups = [
    { section: "Support", items: [
      { label: "Feedback", href: "feedback.html" },
      { label: "Privacy Policy", href: "privacy.html" },
    ] },
  ];

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

  const renderItems = (activeProfile, activeAdmin = activeAdminState) => {
    activeProfileState = activeProfile;
    activeAdminState = activeAdmin;
    drawer.querySelectorAll(".nav-qr-row, .drawer-link, .drawer-section-label").forEach((el) => el.remove());
    const groups = [
      ...(activeAdmin ? [adminGroup] : []),
      ...(activeProfile ? profileGroups : guestGroups),
    ];

    for (const group of groups) {
      const heading = document.createElement("p");
      heading.className = "drawer-section-label";
      heading.textContent = group.section;
      drawer.appendChild(heading);

      for (const it of group.items) {
        const el = document.createElement("a");
        el.href = it.href;
        const itemPage = it.href.split("#")[0];
        const currentItem = location.hash
          ? it.href === `${here}${location.hash}`
          : !it.href.includes("#") && itemPage === here;
        if (currentItem) {
          el.classList.add("active");
          el.setAttribute("aria-current", "page");
        }
        el.addEventListener("click", close); // same-page anchors don't reload
        el.classList.add("drawer-link");
        el.textContent = it.label;
        drawer.appendChild(el);
      }
    }

    if (here === "invoice.html") {
      const print = document.createElement("button");
      print.type = "button";
      print.classList.add("drawer-link");
      print.textContent = "Print / Save PDF";
      print.onclick = () => { close(); window.print(); };
      drawer.appendChild(print);
    }

    document.body.dataset.profileNavigation = activeProfile ? "active" : "guest";
  };

  renderItems(hasLocalProfileMarker(), false);

  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  document.body.append(backdrop, drawer);

  const toggle = document.getElementById("nav-toggle");
  if (toggle) {
    toggle.addEventListener("click", () =>
      drawer.classList.contains("open") ? close() : open());
  }

  // getMyProfile only restores and reads an existing session/profile; it
  // never signs a visitor in and never writes an auth or Firestore artifact.
  // A feedback-only identity is deliberately not treated as an active tab.
  if (window.FS && typeof window.FS.getMyProfile === "function") {
    window.FS.getMyProfile()
      .then((profile) => {
        const activeProfile = !!(
          profile &&
          profile.userId &&
          profile.vipStatus !== "feedback" &&
          window.FS.hasActiveTab(profile)
        );
        if (activeProfile) {
          localStorage.setItem(activeProfileKey, "1");
          renderItems(true);
        } else if (!hasTabMarker()) {
          localStorage.removeItem(activeProfileKey);
          renderItems(false);
        }
      })
      .catch(() => {
        // Keep the synchronous state when Firebase is unavailable; this lets
        // a previously verified profile retain navigation across page tabs.
      });

    // This is a read-only verification against the API (never Firestore
    // directly - the client stopped holding its own Firestore handle when
    // firebase-store.js became a thin API client, which had silently made
    // the old direct-Firestore admin check here dead code). A 403 from
    // /admin/whoami just means "not an admin" - not a real failure.
    window.FS.restoreSession()
      .then(async (user) => {
        if (!user || user.isAnonymous) return false;
        try {
          await window.FS._apiFetch("/admin/whoami");
          return true;
        } catch (error) {
          return false;
        }
      })
      .then((activeAdmin) => {
        if (activeAdmin) renderItems(activeProfileState, true);
      })
      .catch(() => {
        // Keep customer navigation available if admin verification fails.
      });
  }

  window.addEventListener("storage", (event) => {
    if ([activeProfileKey, "fresh_snacks_device_started", "fresh_snacks_linked_to"].includes(event.key)) {
      renderItems(hasLocalProfileMarker(), activeAdminState);
    }
  });
})();
