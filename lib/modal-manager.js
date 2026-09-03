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
    this.inputDialog.setInfoMessage(infoMessage);
    this.inputDialog.setPlaceholderText(placeholderText);
    this.inputDialog.clearStatus();
    this.inputDialog.clearLoadingState();
    this.inputDialog.show({
      ...(crumb ? { crumb } : {}),
      query,
      selectQuery: true,
    });
  }

  async confirmInput(query) {
    const value = query.trim();
    if (!this.pendingInput?.allowEmpty && !value) {
      await this.inputDialog.setStatus({ type: "error", message: "Enter a value." });
      return;
    }

    try {
      const succeeded = await this.pendingInput?.onConfirm(value, this.inputDialog);
      if (succeeded !== false) this.inputDialog.hide();
    } catch (error) {
      await this.inputDialog.clearLoadingState();
      await this.inputDialog.setStatus({ type: "error", message: errorMessage(error) });
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
    await this.selectList.update({
      items: items || [],
      emptyMessage,
      loadingMessage: loadingMessage || null,
      status: null,
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
      await this.selectList.update({ status: { type: "error", message: errorMessage(error) } });
    }
  }

  async showSecondarySelection({ items, emptyMessage = "No items available", crumb, onConfirm }) {
    this.pendingSecondarySelection = { onConfirm };
    await this.secondarySelectList.update({
      items,
      emptyMessage,
      loadingMessage: null,
      status: null,
    });
    this.secondarySelectList.show(crumb ? { crumb } : undefined);
  }

  async confirmSecondarySelection(item) {
    try {
      const succeeded = await this.pendingSecondarySelection?.onConfirm(item);
      if (succeeded !== false) this.secondarySelectList.hide();
    } catch (error) {
      await this.secondarySelectList.update({
        status: { type: "error", message: errorMessage(error) },
      });
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
