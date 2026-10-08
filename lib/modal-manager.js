const DiffReport = require("./diff-report");
const { CompositeDisposable } = require("lumine");

function renderItem(item, { highlight }) {
  return {
    className: ["git-command-action", item.className].filter(Boolean),
    icon: [item.icon || "icon-terminal"],
    primary: highlight(item.label),
    secondary: item.detail || undefined,
    trailing: item.trailing || [],
  };
}

function itemId(item) {
  for (const key of ["id", "branch", "sha", "remote", "reference", "action"]) {
    if (item[key] != null) return `${key}:${item[key]}`;
  }
  throw new TypeError("Git selection items require a stable identifier.");
}

module.exports = class ModalManager {
  constructor({ patchView = null } = {}) {
    this.patchView = patchView;
    this.inputRevision = 0;
    this.destroyed = false;
    this.preview = document.createElement("div");
    this.preview.className = "git-command-preview";

    this.inputDialogHost = lumine.workspace.addInputDialog(
      {
        contentElement: this.preview,
        commands: {
          "git-command:confirm-input": {
            description: "Submit the entered value to the pending Git command.",
            didDispatch: () => this.confirmInput(this.inputDialog.getQuery()),
          },
        },
        actions: [
          {
            command: "git-command:confirm-input",
            context: "dialog",
            primary: true,
            // Empty input, a false callback result, and failures all keep the
            // prompt open; confirmInput() closes it only after success.
            disposition: "stay",
            dispatch: "local",
          },
        ],
      },
      { className: "git-command-input" },
    );
    this.inputDialog = this.inputDialogHost.getModel();
    this.subscriptions = new CompositeDisposable(
      this.inputDialogHost.onDidHide(() => {
        this.pendingInput = null;
        this.clearPreview();
      }),
    );

    this.selectListHost = lumine.workspace.addSelectList(
      {
        items: [],
        emptyMessage: "No items available",
        getItemId: itemId,
        search: {
          getFilterText: (item) => item.searchText || `${item.label} ${item.detail || ""}`,
        },
        renderItem,
        commands: {
          "git-command:confirm-selection": {
            description: "Use the selected item for the pending Git operation.",
            didDispatch: (event) => this.confirmSelection(event.detail.item),
          },
        },
        actions: [
          {
            command: "git-command:confirm-selection",
            context: "item",
            primary: true,
            // The callback decides whether this step closes, stays after a
            // failure, or pushes the nested stash-action step.
            disposition: "stay",
            dispatch: "local",
          },
        ],
      },
      { className: "git-command-select" },
    );
    this.selectList = this.selectListHost.getModel();

    this.secondarySelectListHost = lumine.workspace.addSelectList(
      {
        items: [],
        emptyMessage: "No items available",
        getItemId: itemId,
        search: {
          getFilterText: (item) => item.searchText || `${item.label} ${item.detail || ""}`,
        },
        renderItem,
        commands: {
          "git-command:confirm-secondary-selection": {
            description: "Run the selected operation on the pending Git item.",
            didDispatch: (event) => this.confirmSecondarySelection(event.detail.item),
          },
        },
        actions: [
          {
            command: "git-command:confirm-secondary-selection",
            context: "item",
            primary: true,
            disposition: "stay",
            dispatch: "local",
          },
        ],
      },
      { className: "git-command-select" },
    );
    this.secondarySelectList = this.secondarySelectListHost.getModel();
    this.subscriptions.add(
      this.selectListHost.onDidHide(() => {
        this.pendingSelection = null;
      }),
      this.secondarySelectListHost.onDidHide(() => {
        this.pendingSecondarySelection = null;
      }),
    );
  }

  showInput({
    infoMessage,
    placeholderText,
    query = "",
    preview = "",
    previewData = null,
    crumb,
    allowEmpty = false,
    onConfirm,
  }) {
    if (this.destroyed) return;
    this.inputRevision++;
    this.pendingInput = { allowEmpty, onConfirm };
    this.clearPreview();
    if (previewData) {
      this.diffReport = new DiffReport({
        data: previewData,
        patchView: this.patchView,
        title: "Commit Preview",
      });
      this.preview.classList.add("git-command-preview--diff");
      this.preview.append(this.diffReport.element);
    } else if (preview) {
      const pre = document.createElement("pre");
      pre.textContent = preview;
      this.preview.append(pre);
    }
    this.inputDialog.setInfoMessage(infoMessage);
    this.inputDialog.setPlaceholderText(placeholderText);
    this.inputDialog.clearStatus();
    this.inputDialog.clearLoadingState();
    this.inputDialogHost.show({
      ...(crumb ? { crumb } : {}),
      query,
      selectQuery: true,
    });
  }

  async confirmInput(query) {
    const pending = this.pendingInput;
    const isCurrent = this.confirmationOwner("pendingInput", pending, this.inputDialogHost);
    if (!isCurrent()) return;
    const value = query.trim();
    if (!pending.allowEmpty && !value) {
      await this.inputDialog.setStatus({ type: "error", message: "Enter a value." });
      return;
    }

    try {
      // Controller callbacks may update loading/status after their Git await.
      // Keep those writes attached to this prompt, just like the final hide.
      const dialog = {
        update: (props) => (isCurrent() ? this.inputDialog.update(props) : Promise.resolve()),
      };
      const succeeded = await pending.onConfirm(value, dialog, isCurrent);
      if (isCurrent() && succeeded !== false) this.inputDialogHost.hide();
    } catch (error) {
      if (isCurrent())
        await this.inputDialog.update({
          loadingMessage: null,
          status: { type: "error", message: errorMessage(error) },
        });
    }
  }

  setPatchView(patchView) {
    this.patchView = patchView;
    this.diffReport?.update({ patchView });
  }

  clearPreview() {
    this.diffReport?.destroy();
    this.diffReport = null;
    this.preview.replaceChildren();
    this.preview.classList.remove("git-command-preview--diff");
  }

  async showSelection({
    items,
    loadingMessage,
    emptyMessage = "No items available",
    crumb,
    onConfirm,
  }) {
    if (this.destroyed) return;
    const pending = (this.pendingSelection = { onConfirm });
    await this.selectList.update({ emptyMessage });
    if (this.destroyed || this.pendingSelection !== pending) return;
    await this.selectList.setItems(items || []);
    if (this.destroyed || this.pendingSelection !== pending) return;
    if (loadingMessage) {
      await this.selectList.setLoadingState({ message: loadingMessage });
    } else {
      await this.selectList.clearLoadingState();
    }
    if (this.destroyed || this.pendingSelection !== pending) return;
    await this.selectList.clearStatus();
    if (this.destroyed || this.pendingSelection !== pending) return;
    this.selectListHost.show(crumb ? { crumb } : undefined);
  }

  async updateSelection(items) {
    if (this.destroyed || !this.pendingSelection) return;
    const pending = this.pendingSelection;
    await this.selectList.setItems(items);
    if (!this.destroyed && this.pendingSelection === pending)
      await this.selectList.clearLoadingState();
  }

  async confirmSelection(item) {
    const pending = this.pendingSelection;
    const isCurrent = this.confirmationOwner("pendingSelection", pending, this.selectListHost);
    if (!isCurrent()) return;
    try {
      const succeeded = await pending.onConfirm(item, isCurrent);
      if (isCurrent() && succeeded !== false) this.selectListHost.hide();
    } catch (error) {
      if (isCurrent())
        await this.selectList.setStatus({ type: "error", message: errorMessage(error) });
    }
  }

  async showSecondarySelection({ items, emptyMessage = "No items available", crumb, onConfirm }) {
    if (this.destroyed) return;
    const pending = (this.pendingSecondarySelection = { onConfirm });
    await this.secondarySelectList.update({ emptyMessage });
    if (this.destroyed || this.pendingSecondarySelection !== pending) return;
    await this.secondarySelectList.setItems(items);
    if (this.destroyed || this.pendingSecondarySelection !== pending) return;
    await this.secondarySelectList.clearLoadingState();
    if (this.destroyed || this.pendingSecondarySelection !== pending) return;
    await this.secondarySelectList.clearStatus();
    if (this.destroyed || this.pendingSecondarySelection !== pending) return;
    this.secondarySelectListHost.show(crumb ? { crumb } : undefined);
  }

  async confirmSecondarySelection(item) {
    const pending = this.pendingSecondarySelection;
    const isCurrent = this.confirmationOwner(
      "pendingSecondarySelection",
      pending,
      this.secondarySelectListHost,
    );
    if (!isCurrent()) return;
    try {
      const succeeded = await pending.onConfirm(item, isCurrent);
      if (isCurrent() && succeeded !== false) this.secondarySelectListHost.hide();
    } catch (error) {
      if (isCurrent())
        await this.secondarySelectList.setStatus({
          type: "error",
          message: errorMessage(error),
        });
    }
  }

  confirmationOwner(key, pending, host) {
    return () => Boolean(!this.destroyed && pending && this[key] === pending && host.isVisible());
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.subscriptions.dispose();
    this.clearPreview();
    this.patchView = null;
    this.pendingInput = null;
    this.pendingSelection = null;
    this.pendingSecondarySelection = null;
    return Promise.all([
      this.inputDialogHost.destroy(),
      this.selectListHost.destroy(),
      this.secondarySelectListHost.destroy(),
    ]);
  }
};

function errorMessage(error) {
  return String(error?.stderr || error?.message || error || "Unknown Git error").trim();
}
