/* Shared admin modal helpers - replaces native alert()/confirm()/prompt()
 * with the app's own modal styling (reuses .modal-backdrop/.modal/.modal-actions
 * from styles.css) so the admin pages read as one consistent product instead
 * of mixing in browser-chrome dialogs. Injects its markup into <body> once;
 * safe to include on any admin page regardless of what else is on it. */
(function () {
  const mount = document.createElement("div");
  mount.innerHTML = `
    <div class="modal-backdrop" id="am-confirm-backdrop">
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="am-confirm-title">
        <h2 id="am-confirm-title"></h2>
        <p class="muted-small" id="am-confirm-message" style="margin-bottom:16px;"></p>
        <div class="modal-actions">
          <button type="button" id="am-confirm-cancel">Cancel</button>
          <button type="button" class="primary" id="am-confirm-ok">Confirm</button>
        </div>
      </div>
    </div>
    <div class="modal-backdrop" id="am-alert-backdrop">
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="am-alert-title">
        <h2 id="am-alert-title"></h2>
        <p class="muted-small" id="am-alert-message" style="margin-bottom:16px;"></p>
        <div class="modal-actions">
          <button type="button" class="primary" id="am-alert-ok">OK</button>
        </div>
      </div>
    </div>
    <div class="modal-backdrop" id="am-edit-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="am-edit-title">
        <h2 id="am-edit-title">Change listing</h2>
        <div class="form-grid">
          <div class="field">
            <label for="am-edit-qty">Quantity</label>
            <input id="am-edit-qty" type="number" min="0" step="1" />
          </div>
          <div class="field">
            <label for="am-edit-total">Total value</label>
            <input id="am-edit-total" type="number" min="0" step="1" />
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" id="am-edit-cancel">Cancel</button>
          <button type="button" class="primary" id="am-edit-save">Save</button>
        </div>
      </div>
    </div>`;
  document.body.append(...mount.children);

  const $ = (id) => document.getElementById(id);

  window.AdminModals = {
    // Promise<boolean> - true if confirmed, false if cancelled/dismissed
    confirm(title, message, opts = {}) {
      return new Promise((resolve) => {
        $("am-confirm-title").textContent = title;
        $("am-confirm-message").textContent = message;
        const backdrop = $("am-confirm-backdrop");
        const okBtn = $("am-confirm-ok");
        const cancelBtn = $("am-confirm-cancel");
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
        $("am-alert-title").textContent = title;
        $("am-alert-message").textContent = message;
        const backdrop = $("am-alert-backdrop");
        const okBtn = $("am-alert-ok");
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

    // Promise<{quantity, total}|null> - null if cancelled
    editListing(current) {
      return new Promise((resolve) => {
        $("am-edit-qty").value = current.quantity ?? 1;
        $("am-edit-total").value = current.total ?? 0;
        const backdrop = $("am-edit-backdrop");
        const saveBtn = $("am-edit-save");
        const cancelBtn = $("am-edit-cancel");
        const cleanup = (result) => {
          backdrop.classList.remove("show");
          saveBtn.onclick = null;
          cancelBtn.onclick = null;
          backdrop.onclick = null;
          resolve(result);
        };
        saveBtn.onclick = () => cleanup({ quantity: $("am-edit-qty").value, total: $("am-edit-total").value });
        cancelBtn.onclick = () => cleanup(null);
        backdrop.onclick = (ev) => { if (ev.target === backdrop) cleanup(null); };
        backdrop.classList.add("show");
        $("am-edit-qty").focus();
      });
    },
  };
})();
