/* Customer navigation: hamburger-toggled left drawer.
 * Pages include a button#nav-toggle in their header; this script injects
 * the drawer and backdrop. Admin is deliberately not listed — it lives at
 * its own URL (admin.html) for the snack keeper only. */
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

  const profileItems = [
        { label: "My tab", href: "index.html" },
        { label: "Log my snacks", href: "bins.html" },
        { label: "Invoice Me", href: "invoice.html" },
        { label: "User settings", href: "index.html#user-settings" },
        { label: "Feedback", href: "feedback.html" },
        { label: "Privacy Policy", href: "privacy.html" },
      ];
  const guestItems = [
        { label: "Feedback", href: "feedback.html" },
        { label: "Privacy Policy", href: "privacy.html" },
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
    drawer.querySelectorAll(".nav-qr-row, .drawer-link").forEach((el) => el.remove());
    const items = [...(activeProfile ? profileItems : guestItems)];
    if (activeAdmin) items.unshift({ label: "Admin dashboard", href: "admin.html" });
    if (here === "invoice.html") items.push({ label: "Print / Save PDF", print: true });

    for (const it of items) {
      let el;
      if (it.print) {
        el = document.createElement("button");
        el.type = "button";
        el.onclick = () => { close(); window.print(); };
      } else {
        el = document.createElement("a");
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
      }
      el.classList.add("drawer-link");
      el.textContent = it.label;
      drawer.appendChild(el);
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
          profile.displayName &&
          profile.vipStatus !== "feedback"
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

    // This is a read-only verification. It never creates an Auth user,
    // customer profile, or Firestore document.
    window.FS.restoreSession()
      .then(async (user) => {
        if (!user || user.isAnonymous) return false;
        const admin = await window.FS._db.collection("admins").doc(user.uid).get();
        return admin.exists && admin.data().active === true;
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
