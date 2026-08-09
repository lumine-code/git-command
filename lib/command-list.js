const ACTIONS = [
  {
    action: "status",
    label: "Status",
    detail: "Show branch, upstream, and working-tree changes.",
    icon: "icon-list-unordered",
  },
  {
    action: "stage-current-file",
    label: "Stage current file",
    detail: "Add the active file to the index.",
    icon: "icon-plus",
  },
  {
    action: "stage-all",
    label: "Stage all",
    detail: "Add every working-tree change to the index.",
    icon: "icon-plus",
  },
  {
    action: "unstage-current-file",
    label: "Unstage current file",
    detail: "Remove the active file from the index.",
    icon: "icon-dash",
  },
  {
    action: "unstage-all",
    label: "Unstage all",
    detail: "Remove every staged change from the index.",
    icon: "icon-dash",
  },
  {
    action: "commit",
    label: "Commit",
    detail: "Preview and commit staged changes.",
    icon: "icon-git-commit",
    modal: true,
  },
  {
    action: "stage-all-and-commit",
    label: "Stage all and commit",
    detail: "Stage every change, then preview and commit.",
    icon: "icon-git-commit",
    modal: true,
  },
  {
    action: "quick-commit-current-file",
    label: "Quick commit current file",
    detail: "Preview, stage, and commit only the active file.",
    icon: "icon-zap",
    modal: true,
  },
  {
    action: "amend",
    label: "Amend",
    detail: "Preview staged changes and replace the latest commit.",
    icon: "icon-pencil",
    modal: true,
  },
  {
    action: "diff-current-file",
    label: "Diff current file",
    detail: "Show staged and unstaged changes for the active file.",
    icon: "icon-diff",
  },
  {
    action: "diff-all",
    label: "Diff all",
    detail: "Show every staged and unstaged change.",
    icon: "icon-diff",
  },
  {
    action: "log",
    label: "Log",
    detail: "Show recent repository history.",
    icon: "icon-history",
  },
  {
    action: "log-current-file",
    label: "Log current file",
    detail: "Show recent history for the active file.",
    icon: "icon-history",
  },
  {
    action: "blame-current-file",
    label: "Blame current file",
    detail: "Show the commit and author for each line.",
    icon: "icon-person",
  },
  {
    action: "open-changed-files",
    label: "Open changed files",
    detail: "Open every changed path in the active repository.",
    icon: "icon-file-directory",
  },
  {
    action: "restore-current-file",
    label: "Restore current file",
    detail: "Discard staged and unstaged changes to the active file.",
    icon: "icon-discard",
  },
  {
    action: "checkout",
    label: "Checkout branch",
    detail: "Choose a local branch.",
    icon: "icon-git-branch",
    modal: true,
  },
  {
    action: "new-branch",
    label: "New branch",
    detail: "Create and check out a branch.",
    icon: "icon-plus",
    modal: true,
  },
  {
    action: "merge",
    label: "Merge branch",
    detail: "Choose a local branch to merge.",
    icon: "icon-git-merge",
    modal: true,
  },
  {
    action: "rebase",
    label: "Rebase onto branch",
    detail: "Choose a local branch as the new base.",
    icon: "icon-git-compare",
    modal: true,
  },
  {
    action: "cherry-pick",
    label: "Cherry-pick commit",
    detail: "Choose a recent commit to apply.",
    icon: "icon-git-commit",
    modal: true,
  },
  {
    action: "fetch",
    label: "Fetch remote",
    detail: "Choose and prune a remote.",
    icon: "icon-cloud-download",
    modal: true,
  },
  {
    action: "fetch-all",
    label: "Fetch all repositories",
    detail: "Fetch every remote in every open repository.",
    icon: "icon-sync",
  },
  {
    action: "pull",
    label: "Pull",
    detail: "Pull the current branch from its upstream.",
    icon: "icon-move-down",
  },
  {
    action: "push",
    label: "Push",
    detail: "Push the current branch and set its upstream when needed.",
    icon: "icon-move-up",
  },
  {
    action: "stash",
    label: "Stash changes",
    detail: "Create a stash with an optional message.",
    icon: "icon-package",
    modal: true,
  },
  {
    action: "manage-stashes",
    label: "Manage stashes",
    detail: "Apply, pop, or drop an existing stash.",
    icon: "icon-package",
    modal: true,
  },
  {
    action: "run",
    label: "Run Git arguments",
    detail: "Execute an arbitrary argument line after git.",
    icon: "icon-terminal",
    modal: true,
  },
];

class CommandList {
  constructor(controller) {
    this.controller = controller;
    this.selectList = lumine.workspace.buildSelectList({
      className: "git-command-list",
      crumb: "Git command",
      items: ACTIONS,
      emptyMessage: "No matching Git actions",
      filterKeyForItem: (item) => `${item.label} ${item.detail}`,
      elementForItem: (item, { highlight }) => ({
        className: "git-command-action",
        icon: [item.icon],
        primary: highlight(item.label),
        secondary: item.detail,
      }),
      didConfirmSelection: (item) => {
        if (!item.modal) this.hide();
        this.controller.perform(item.action, { crumb: item.label });
      },
      didCancelSelection: () => this.hide(),
    });
  }

  toggle() {
    if (this.selectList.isVisible()) {
      this.hide();
      return;
    }
    this.selectList.reset();
    this.selectList.show();
  }

  hide() {
    this.selectList.hide();
  }

  destroy() {
    this.selectList.destroy();
  }
}

module.exports = { ACTIONS, CommandList };
