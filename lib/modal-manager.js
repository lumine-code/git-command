function itemElement(item, { highlight }) {
  return {
    className: ["git-command-action", item.className].filter(Boolean),
    icon: [item.icon || "icon-terminal"],
    primary: highlight(item.label),
    secondary: item.detail || undefined,
    trailing: item.trailing || [],
  };
}

module.exports = class ModalManager {
  constructor() {
    this.preview = document.createElement("pre");
    this.preview.className = "git-command-preview";

    this.inputDialog = lumine.workspace.buildInputDialog({
      className: "git-command-input",
      contentElement: this.preview,
      didChangeQuery: () => this.inputDialog.update({ errorMessage: null }),
      didConfirm: (query) => this.confirmInput(query),
      didCancel: () => this.inputDialog.hide(),
    });

    this.selectList = lumine.workspace.buildSelectList({
      className: "git-command-select",
      items: [],
      emptyMessage: "No items available",
      filterKeyForItem: (item) => item.searchText || `${item.label} ${item.detail || ""}`,
      elementForItem: itemElement,
      didConfirmSelection: (item) => this.confirmSelection(item),
      didCancelSelection: () => this.selectList.hide(),
    });

    this.secondarySelectList = lumine.workspace.buildSelectList({
      className: "git-command-select",
      items: [],
      emptyMessage: "No items available",
      filterKeyForItem: (item) => item.searchText || `${item.label} ${item.detail || ""}`,
      elementForItem: itemElement,
      didConfirmSelection: (item) => this.confirmSecondarySelection(item),
      didCancelSelection: () => this.secondarySelectList.hide(),
    });
  }

  showInput({
    infoMessage,
    placeholderText,
    query = "",
    preview = "",
    crumb,
    allowEmpty = false,
    onConfirm,
  }) {
    this.pendingInput = { allowEmpty, onConfirm };
    this.preview.textContent = preview;
    this.inputDialog.reset();
    this.inputDialog.update({
      query,
      infoMessage,
      placeholderText,
      errorMessage: null,
      contentElement: this.preview,
      loadingMessage: null,
      loadingSpinner: false,
    });
    this.inputDialog.show(crumb ? { crumb } : undefined);
  }

  async confirmInput(query) {
    const value = query.trim();
    if (!this.pendingInput?.allowEmpty && !value) {
      await this.inputDialog.update({ errorMessage: "Enter a value." });
      return;
    }

    try {
      const succeeded = await this.pendingInput?.onConfirm(value, this.inputDialog);
      if (succeeded !== false) this.inputDialog.hide();
    } catch (error) {
      await this.inputDialog.update({
        loadingMessage: null,
        loadingSpinner: false,
        errorMessage: errorMessage(error),
      });
    }
  }

  async showSelection({
    items,
    loadingMessage,
    emptyMessage = "No items available",
    crumb,
    onConfirm,
  }) {
    this.pendingSelection = { onConfirm };
    this.selectList.reset();
    await this.selectList.update({
      items: items || [],
      emptyMessage,
      loadingMessage: loadingMessage || null,
      errorMessage: null,
    });
    this.selectList.show(crumb ? { crumb } : undefined);
  }

  async updateSelection(items) {
    await this.selectList.update({ items, loadingMessage: null });
  }

  async confirmSelection(item) {
    try {
      const succeeded = await this.pendingSelection?.onConfirm(item);
      if (succeeded !== false) this.selectList.hide();
    } catch (error) {
      await this.selectList.update({ errorMessage: errorMessage(error) });
    }
  }

  async showSecondarySelection({ items, emptyMessage = "No items available", crumb, onConfirm }) {
    this.pendingSecondarySelection = { onConfirm };
    this.secondarySelectList.reset();
    await this.secondarySelectList.update({
      items,
      emptyMessage,
      loadingMessage: null,
      errorMessage: null,
    });
    this.secondarySelectList.show(crumb ? { crumb } : undefined);
  }

  async confirmSecondarySelection(item) {
    try {
      const succeeded = await this.pendingSecondarySelection?.onConfirm(item);
      if (succeeded !== false) this.secondarySelectList.hide();
    } catch (error) {
      await this.secondarySelectList.update({ errorMessage: errorMessage(error) });
    }
  }

  destroy() {
    this.inputDialog.destroy();
    this.selectList.destroy();
    this.secondarySelectList.destroy();
  }
};

function errorMessage(error) {
  return String(error?.stderr || error?.message || error || "Unknown Git error").trim();
}
