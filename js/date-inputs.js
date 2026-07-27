/* Clicking a native <input type="date"> only opens its calendar popup when
 * the tiny icon is hit - clicking the date text itself just drops a text
 * cursor into a segment. Delegating on document (rather than binding each
 * input individually) means this also covers date fields injected later by
 * modals (js/admin-modals.js, js/admin-notifications.js) with no extra code
 * at each call site. showPicker() is Chromium-only; unsupported browsers
 * silently keep the native default-click behavior. */
document.addEventListener("click", (event) => {
  const input = event.target.closest('input[type="date"]');
  if (input && !input.disabled && !input.readOnly && typeof input.showPicker === "function") {
    try {
      input.showPicker();
    } catch (_) {
      /* ignored - e.g. picker already open, or blocked by browser policy */
    }
  }
});
