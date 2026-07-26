/* Shared customer modal helpers - replaces native alert()/confirm() with the
 * app's own modal styling (reuses .modal-backdrop/.modal/.modal-actions from
 * styles.css), mirroring js/admin-modals.js's pattern for the customer-facing
 * pages. Injects its markup into <body> once; safe to include on any
 * customer page regardless of what else is on it. */
(function () {
  const mount = document.createElement("div");
  mount.innerHTML = `
    <div class="modal-backdrop" id="cm-confirm-backdrop">
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="cm-confirm-title">
        <h2 id="cm-confirm-title"></h2>
        <p class="muted-small" id="cm-confirm-message" style="margin-bottom:16px;"></p>
        <div class="modal-actions">
          <button type="button" id="cm-confirm-cancel">Cancel</button>
          <button type="button" class="primary" id="cm-confirm-ok">Confirm</button>
        </div>
      </div>
    </div>
    <div class="modal-backdrop" id="cm-alert-backdrop">
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="cm-alert-title">
        <h2 id="cm-alert-title"></h2>
        <p class="muted-small" id="cm-alert-message" style="margin-bottom:16px;"></p>
        <div class="modal-actions">
          <button type="button" class="primary" id="cm-alert-ok">OK</button>
        </div>
      </div>
    </div>`;
  document.body.append(...mount.children);

  const $ = (id) => document.getElementById(id);

  window.AppModals = {
    // Promise<boolean> - true if confirmed, false if cancelled/dismissed
    confirm(title, message, opts = {}) {
      return new Promise((resolve) => {
        $("cm-confirm-title").textContent = title;
        $("cm-confirm-message").textContent = message;
        const backdrop = $("cm-confirm-backdrop");
        const okBtn = $("cm-confirm-ok");
        const cancelBtn = $("cm-confirm-cancel");
        okBtn.textContent = opts.confirmText || "Confirm";
        okBtn.className = opts.danger ? "danger" : "primary";
        const cleanup = (result) => {
          backdrop.classList.remove("show");
          okBtn.onclick = null;
          cancelBtn.onclick = null;
          backdrop.onclick = null;
          resolve(result);
        };
        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        backdrop.onclick = (ev) => { if (ev.target === backdrop) cleanup(false); };
        backdrop.classList.add("show");
        okBtn.focus();
      });
    },

    // Promise<void> - resolves once dismissed
    alert(title, message) {
      return new Promise((resolve) => {
        $("cm-alert-title").textContent = title;
        $("cm-alert-message").textContent = message;
        const backdrop = $("cm-alert-backdrop");
        const okBtn = $("cm-alert-ok");
        const cleanup = () => {
          backdrop.classList.remove("show");
          okBtn.onclick = null;
          backdrop.onclick = null;
          resolve();
        };
        okBtn.onclick = cleanup;
        backdrop.onclick = (ev) => { if (ev.target === backdrop) cleanup(); };
        backdrop.classList.add("show");
        okBtn.focus();
      });
    },
  };
})();
