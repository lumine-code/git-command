const fs = require("fs/promises");
const path = require("path");

const { parseCommandLine } = require("./command-line");
const {
  formatBlame,
  formatCommits,
  formatStatus,
  parseStashes,
  repositoryName,
} = require("./formatters");
const ModalManager = require("./modal-manager");
const { OutputManager } = require("./output-view");
const { readFilePreview } = require("./file-preview");

const ACTION_METHODS = {
  status: "showStatus",
  "stage-current-file": "stageCurrentFile",
  "stage-all": "stageAll",
  "unstage-current-file": "unstageCurrentFile",
  "unstage-all": "unstageAll",
  commit: "commit",
  "stage-all-and-commit": "stageAllAndCommit",
  "quick-commit-current-file": "quickCommitCurrentFile",
  amend: "amend",
  "diff-current-file": "diffCurrentFile",
  "diff-all": "diffAll",
  log: "log",
  "log-current-file": "logCurrentFile",
  "blame-current-file": "blameCurrentFile",
  "open-changed-files": "openChangedFiles",
  "restore-current-file": "restoreCurrentFile",
  checkout: "checkout",
  "new-branch": "newBranch",
  merge: "merge",
  rebase: "rebase",
  "cherry-pick": "cherryPick",
  fetch: "fetch",
  "fetch-all": "fetchAll",
  pull: "pull",
  push: "push",
  stash: "stash",
  "manage-stashes": "manageStashes",
  run: "run",
};
const FILE_ACTIONS = new Set([
  "stage-current-file",
  "unstage-current-file",
  "quick-commit-current-file",
  "diff-current-file",
  "log-current-file",
  "blame-current-file",
  "restore-current-file",
]);

module.exports = class Controller {
  constructor({ patchView = null } = {}) {
    this.patchView = patchView;
    this.modals = new ModalManager({ patchView });
    this.outputs = new OutputManager({ patchView });
    this.diffRequests = new Map();
    this.commitRequest = 0;
  }

  setPatchView(patchView) {
    this.patchView = patchView;
    this.modals.setPatchView(patchView);
    this.outputs.setPatchView(patchView);
  }

  async perform(action, options = {}) {
    const method = ACTION_METHODS[action];
    if (!method || typeof this[method] !== "function") {
      return Promise.reject(new Error(`Unknown Git action: ${action}`));
    }
    try {
      const scope = FILE_ACTIONS.has(action) ? "file" : "repository";
      let context = lumine.repositories.getCommandContext(options.event, { scope });
      if (scope === "file" && !context.editor) return;
      if (scope === "file" && !context.path) {
        lumine.notifications.addWarning("Save the active file before running this Git action.");
        return;
      }
      if (scope === "file" && context.path && !context.repository) {
        context = {
          ...context,
          repository: await lumine.repositories.resolveForPath(context.path),
        };
      }
      return await this[method]({ ...options, context });
    } catch (error) {
      return this.reportError(action, error);
    }
  }

  getRepository(context) {
    const repository = context ? context.repository : lumine.repositories.getActiveRepository();
    if (!repository) {
      lumine.notifications.addInfo("No Git repository is open.");
      return null;
    }
    return repository;
  }

  getOperations(repository, operationName, { silent = false } = {}) {
    const operations = repository?.getOperations?.();
    if (!operations?.isAvailable(operationName)) {
      if (!silent) {
        lumine.notifications.addError(`Git ${operationName} is unavailable`, {
          description: "The active repository has no provider for this operation.",
          dismissable: true,
        });
      }
      return null;
    }
    return operations;
  }

  getCurrentFile(repository, context) {
    const filePath = context?.path || lumine.workspace.getActiveTextEditor()?.getPath();
    if (!filePath || lumine.repositories.getForPath(filePath) !== repository) {
      lumine.notifications.addInfo("The active editor is not a file in this repository.");
      return null;
    }
    return {
      absolute: filePath,
      relative: repository.posixRelativePath(filePath),
    };
  }

  async runRaw(repository, args, options = {}) {
    const result = await repository
      .getOperations()
      .executeGit(args, { readOnly: true, ...options });
    if (result.exitCode !== 0 && !options.allowedExitCodes?.includes(result.exitCode)) {
      const error = new Error(
        result.stderr.trim() || `git ${args[0]} exited with code ${result.exitCode}`,
      );
      error.stderr = result.stderr;
      error.stdout = result.stdout;
      error.exitCode = result.exitCode;
      throw error;
    }
    return result;
  }

  async runOperation(
    repository,
    operationName,
    callback,
    successMessage,
    isCurrent = () => !this.destroyed,
  ) {
    const operations = this.getOperations(repository, operationName);
    if (!operations) return false;
    await callback(operations);
    if (successMessage && isCurrent()) {
      lumine.notifications.addSuccess(
        typeof successMessage === "function" ? successMessage() : successMessage,
      );
    }
    return true;
  }

  async showOutput(repository, key, title, content) {
    return this.outputs.show(`${repository.getWorkingDirectory()}:${key}`, {
      title,
      subtitle: repositoryName(repository),
      content,
    });
  }

  async showStatus({ context } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    const snapshot = await repository.ensureStatusSnapshot();
    await this.showOutput(repository, "status", "Git Status", formatStatus(snapshot, repository));
  }

  async stageCurrentFile({ context } = {}) {
    const editor = context?.editor || lumine.workspace.getActiveTextEditor();
    const repository = this.getRepository(context);
    const file = repository && this.getCurrentFile(repository, context);
    if (!file) return;
    await this.runOperation(
      repository,
      "stageFiles",
      (operations) => operations.stageFiles([file.relative]),
      () =>
        editor &&
        !editor.isDestroyed() &&
        editor.getPath() === file.absolute &&
        editor.getFileState() === "modified"
          ? `Staged saved version of ${file.relative}; unsaved editor changes were excluded`
          : `Staged ${file.relative}`,
    );
  }

  async stageAll({ context } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    await this.runOperation(
      repository,
      "stageFiles",
      (operations) => operations.stageFiles(["."]),
      "Staged all changes",
    );
  }

  async unstageCurrentFile({ context } = {}) {
    const repository = this.getRepository(context);
    const file = repository && this.getCurrentFile(repository, context);
    if (!file) return;
    await this.runOperation(
      repository,
      "unstageFiles",
      (operations) => operations.unstageFiles([file.relative]),
      `Unstaged ${file.relative}`,
    );
  }

  async unstageAll({ context } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    await this.runOperation(
      repository,
      "unstageFiles",
      (operations) => operations.unstageFiles(["."]),
      "Unstaged all changes",
    );
  }

  async diffData(repository, paths = []) {
    const snapshot = await repository.ensureStatusSnapshot();
    const stagedBase =
      !snapshot.head || snapshot.head.unborn
        ? { type: "empty" }
        : { type: "commit", revision: "HEAD" };
    const [staged, unstaged] = await Promise.all([
      repository.getDiff({
        from: stagedBase,
        to: { type: "index" },
        paths,
        format: "both",
      }),
      repository.getDiff({ paths, format: "both" }),
    ]);
    const sections = [
      { id: "staged", title: "Staged Changes", rawPatch: staged.rawPatch, files: staged.files },
      {
        id: "unstaged",
        title: "Unstaged Changes",
        rawPatch: unstaged.rawPatch,
        files: unstaged.files,
      },
    ];
    const pathSet = new Set(paths);
    const untracked = snapshot.files.filter(
      (entry) => entry.untracked && (pathSet.size === 0 || pathSet.has(entry.path)),
    );
    const untrackedPreviews = [];
    for (const entry of untracked) {
      const filePath = path.join(repository.getWorkingDirectory(), entry.path);
      try {
        const preview = await readFilePreview(filePath);
        untrackedPreviews.push(`Untracked: ${entry.path}\n\n${preview}`);
      } catch {
        untrackedPreviews.push(`Untracked: ${entry.path}\n\nUnable to read this untracked file.`);
      }
    }
    if (untrackedPreviews.length) {
      sections.push({
        id: "untracked",
        title: "Untracked Files",
        text: untrackedPreviews.join("\n\n"),
      });
    }
    return { sections, workingDirectory: repository.getWorkingDirectory?.() || "" };
  }

  // Kept for callers that need a copyable text report rather than a rendered pane.
  async diffText(repository, paths = []) {
    const { sections } = await this.diffData(repository, paths);
    return (
      sections
        .filter(({ rawPatch, text }) => text !== undefined || rawPatch.trim())
        .map(
          ({ title, rawPatch, text }) =>
            `${title.replace(" Changes", " changes")}\n${"=".repeat(title.length)}\n\n${text ?? rawPatch}`,
        )
        .join("\n\n") || "No changes."
    );
  }

  async showDiff(repository, key, title, paths = []) {
    const reportKey = `${repository.getWorkingDirectory()}:${key}`;
    const request = (this.diffRequests.get(reportKey) || 0) + 1;
    this.diffRequests.set(reportKey, request);
    const diffData = await this.diffData(repository, paths);
    if (this.destroyed || this.diffRequests.get(reportKey) !== request) return;
    return this.outputs.show(reportKey, {
      title,
      subtitle: repositoryName(repository),
      diffData,
    });
  }

  async diffCurrentFile({ context } = {}) {
    const repository = this.getRepository(context);
    const file = repository && this.getCurrentFile(repository, context);
    if (!file) return;
    await this.showDiff(repository, `diff:${file.relative}`, `Diff: ${file.relative}`, [
      file.relative,
    ]);
  }

  async diffAll({ context } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    await this.showDiff(repository, "diff", "Git Diff");
  }

  async log({ context } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    const page = await repository.getCommits({ limit: lumine.config.get("git-command.logLimit") });
    await this.showOutput(repository, "log", "Git Log", formatCommits(page.commits));
  }

  async logCurrentFile({ context } = {}) {
    const repository = this.getRepository(context);
    const file = repository && this.getCurrentFile(repository, context);
    if (!file) return;
    const page = await repository.getCommits({
      path: file.relative,
      limit: lumine.config.get("git-command.logLimit"),
    });
    await this.showOutput(
      repository,
      `log:${file.relative}`,
      `History: ${file.relative}`,
      formatCommits(page.commits),
    );
  }

  async blameCurrentFile({ context } = {}) {
    const repository = this.getRepository(context);
    const file = repository && this.getCurrentFile(repository, context);
    if (!file) return;
    const blame = await repository.getBlame(file.relative);
    await this.showOutput(
      repository,
      `blame:${file.relative}`,
      `Blame: ${file.relative}`,
      formatBlame(blame),
    );
  }

  async openChangedFiles({ context } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    const snapshot = await repository.ensureStatusSnapshot();
    let opened = 0;
    for (const entry of snapshot.files) {
      if (entry.ignored) continue;
      const filePath = path.join(repository.getWorkingDirectory(), entry.path);
      // Status includes ignored directories, removed paths, and dirty submodules.
      // Only existing files can become editor tabs. Open them in sequence so a
      // large status snapshot does not start thousands of buffer loads at once.
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
        throw error;
      }
      if (!stat.isFile()) continue;
      await lumine.workspace.open(filePath, { activatePane: false });
      opened++;
    }
    lumine.notifications.addSuccess(`Opened ${opened} changed ${opened === 1 ? "file" : "files"}`);
  }

  async restoreCurrentFile({ context } = {}) {
    const repository = this.getRepository(context);
    const file = repository && this.getCurrentFile(repository, context);
    if (!file) return;
    const answer = await lumine.window.confirm({
      message: `Restore ${file.relative}?`,
      detail: "This discards both staged and unstaged changes to the file.",
      buttons: ["Restore", "Cancel"],
    });
    if (answer !== 0) return;
    await this.runOperation(
      repository,
      "checkoutFiles",
      (operations) => operations.checkoutFiles([file.relative], "HEAD"),
      `Restored ${file.relative}`,
    );
  }

  async commitDialog({ context, crumb, stageAll = false, currentFile = null, amend = false }) {
    const request = ++this.commitRequest;
    const inputRevision = this.modals.inputRevision;
    const repository = this.getRepository(context);
    if (!repository) return;
    const paths = currentFile ? [currentFile.relative] : [];
    const previewData = await this.diffData(repository, paths);
    let query = "";
    if (amend) {
      const previous = await repository.getCommit("HEAD");
      query = previous ? [previous.subject, previous.body].filter(Boolean).join("\n\n") : "";
    }

    if (
      this.destroyed ||
      request !== this.commitRequest ||
      inputRevision !== this.modals.inputRevision
    )
      return;
    const expectedHead = { ...repository.getStatusSnapshot().head };
    this.modals.showInput({
      crumb,
      query,
      previewData,
      infoMessage: amend ? "Edit the amended commit message" : "Enter a commit message",
      placeholderText: "Commit message",
      onConfirm: async (message, dialog, isCurrent) => {
        const operations = this.getOperations(repository, "commit");
        if (!operations) return false;
        await dialog.update({ loadingMessage: "Creating commit…" });
        try {
          await operations.runWorkflow(
            "commit",
            async (direct) => {
              if (stageAll) await direct.stageFiles(["."]);
              if (currentFile) await direct.stageFiles([currentFile.relative]);
              await direct.commit(message, { amend });
            },
            { guards: ["commit"], expectedHead },
          );
          if (isCurrent())
            lumine.notifications.addSuccess(amend ? "Amended the latest commit" : "Created commit");
          return true;
        } catch (error) {
          await dialog.update({
            loadingMessage: null,
            status: { type: "error", message: this.errorMessage(error) },
          });
          return false;
        }
      },
    });
  }

  commit({ crumb, context } = {}) {
    return this.commitDialog({ crumb, context });
  }

  stageAllAndCommit({ crumb, context } = {}) {
    return this.commitDialog({ crumb, context, stageAll: true });
  }

  quickCommitCurrentFile({ context, crumb } = {}) {
    const repository = this.getRepository(context);
    const currentFile = repository && this.getCurrentFile(repository, context);
    if (!currentFile) return undefined;
    return this.commitDialog({ crumb, context, currentFile });
  }

  amend({ crumb, context } = {}) {
    return this.commitDialog({ crumb, context, amend: true });
  }

  async prepareSelection(options, loadItems) {
    const pending = await this.modals.showSelection(options);
    if (!pending || this.destroyed) return;
    try {
      const items = await loadItems();
      if (this.destroyed || this.modals.pendingSelection !== pending) return;
      await this.modals.updateSelection(items, pending);
    } catch (error) {
      if (!this.destroyed && this.modals.pendingSelection === pending) throw error;
    }
  }

  async branchSelection(operationName, crumb, context) {
    const repository = this.getRepository(context);
    if (!repository) return;
    return this.prepareSelection(
      {
        items: [],
        loadingMessage: "Loading branches…",
        emptyMessage: "No other local branches",
        crumb,
        onConfirm: async (item, isCurrent) =>
          this.runOperation(
            repository,
            operationName,
            (operations) => {
              if (operationName === "checkout") return operations.checkout(item.branch);
              return operations[operationName](item.branch);
            },
            `${operationName === "checkout" ? "Checked out" : `${operationName}d`} ${item.branch}`,
            isCurrent,
          ),
      },
      async () => {
        const refs = await repository.ensureRefsSnapshot();
        return refs.branches
          .filter((branch) => !branch.isHead)
          .map((branch) => ({
            branch: branch.name,
            label: branch.name,
            detail: branch.upstream?.name || "Local branch",
            icon: "icon-git-branch",
            searchText: `${branch.name} ${branch.upstream?.name || ""}`,
          }));
      },
    );
  }

  checkout({ crumb, context } = {}) {
    return this.branchSelection("checkout", crumb, context);
  }

  merge({ crumb, context } = {}) {
    return this.branchSelection("merge", crumb, context);
  }

  rebase({ crumb, context } = {}) {
    return this.branchSelection("rebase", crumb, context);
  }

  newBranch({ context, crumb } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    this.modals.showInput({
      crumb,
      infoMessage: "Create a branch from the current HEAD",
      placeholderText: "Branch name",
      onConfirm: (name, _dialog, isCurrent) =>
        this.runOperation(
          repository,
          "checkout",
          (operations) => operations.checkout(name, { createNew: true }),
          `Created and checked out ${name}`,
          isCurrent,
        ),
    });
  }

  async cherryPick({ context, crumb } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    return this.prepareSelection(
      {
        items: [],
        loadingMessage: "Loading commits…",
        emptyMessage: "No commits available",
        crumb,
        onConfirm: (item, isCurrent) =>
          this.runOperation(
            repository,
            "cherryPick",
            (operations) => operations.cherryPick(item.sha),
            `Cherry-picked ${item.sha.slice(0, 8)}`,
            isCurrent,
          ),
      },
      async () => {
        const page = await repository.getCommits({
          allRefs: true,
          limit: lumine.config.get("git-command.logLimit"),
        });
        return page.commits.map((commit) => ({
          sha: commit.sha,
          label: commit.subject,
          detail: `${commit.sha.slice(0, 8)} · ${commit.author.name}`,
          icon: "icon-git-commit",
          searchText: `${commit.sha} ${commit.subject} ${commit.author.name}`,
        }));
      },
    );
  }

  async fetch({ context, crumb } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    return this.prepareSelection(
      {
        items: [],
        loadingMessage: "Loading remotes…",
        emptyMessage: "No remotes configured",
        crumb,
        onConfirm: (item, isCurrent) =>
          this.runOperation(
            repository,
            "fetch",
            (operations) => operations.fetch(item.remote, null, { prune: true }),
            `Fetched ${item.remote}`,
            isCurrent,
          ),
      },
      async () => {
        const refs = await repository.ensureRefsSnapshot();
        return refs.remotes.map((remote) => ({
          remote: remote.name,
          label: remote.name,
          detail: remote.fetchUrl,
          icon: "icon-cloud-download",
          searchText: `${remote.name} ${remote.fetchUrl || ""}`,
        }));
      },
    );
  }

  async fetchAll() {
    const repositories = lumine.repositories.getRepositories();
    let fetched = 0;
    for (const repository of repositories) {
      const operations = this.getOperations(repository, "fetch");
      if (!operations) continue;
      const refs = await repository.ensureRefsSnapshot();
      for (const remote of refs.remotes) {
        await operations.fetch(remote.name, null, { prune: true });
        fetched++;
      }
    }
    lumine.notifications.addSuccess(`Fetched ${fetched} ${fetched === 1 ? "remote" : "remotes"}`);
  }

  async pull({ context } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    await this.runOperation(
      repository,
      "pull",
      (operations) => operations.pullCurrent(),
      "Pulled the current branch",
    );
  }

  async push({ context, crumb } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    const operations = this.getOperations(repository, "push");
    if (!operations) return;
    try {
      await operations.pushCurrent();
      lumine.notifications.addSuccess("Pushed the current branch");
    } catch (error) {
      if (error.code !== "ERR_GIT_REMOTE_CONTEXT") throw error;
      const refs = await repository.ensureRefsSnapshot();
      const branch = refs.branches.find((entry) => entry.isHead);
      if (!branch || refs.remotes.length === 0) throw error;
      await this.modals.showSelection({
        crumb,
        items: refs.remotes.map((remote) => ({
          remote: remote.name,
          label: remote.name,
          detail: remote.pushUrl || remote.fetchUrl,
          icon: "icon-cloud-upload",
          searchText: remote.name,
        })),
        onConfirm: (item, isCurrent) =>
          this.pushTo(repository, branch.name, item.remote, true, isCurrent),
      });
    }
  }

  pushTo(repository, branch, remote, setUpstream, isCurrent) {
    return this.runOperation(
      repository,
      "push",
      (operations) => operations.push(remote, branch, { setUpstream }),
      `Pushed ${branch} to ${remote}`,
      isCurrent,
    );
  }

  stash({ context, crumb } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    this.modals.showInput({
      crumb,
      allowEmpty: true,
      infoMessage: "Enter an optional stash message",
      placeholderText: "Stash message",
      onConfirm: (message, _dialog, isCurrent) => {
        const includeUntracked = lumine.config.get("git-command.stashIncludeUntracked");
        return this.runOperation(
          repository,
          "stashPush",
          (operations) =>
            operations.stashPush({
              message: message || undefined,
              includeUntracked,
            }),
          "Stashed working-tree changes",
          isCurrent,
        );
      },
    });
  }

  async manageStashes({ context, crumb } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    return this.prepareSelection(
      {
        items: [],
        loadingMessage: "Loading stashes…",
        emptyMessage: "No stashes",
        crumb,
        onConfirm: async (stash) => {
          await this.modals.showSecondarySelection({
            crumb: stash.reference,
            items: [
              {
                action: "stashApply",
                label: "Apply",
                past: "Applied",
                detail: "Apply and keep this stash.",
                icon: "icon-check",
              },
              {
                action: "stashPop",
                label: "Pop",
                past: "Popped",
                detail: "Apply and remove this stash.",
                icon: "icon-move-down",
              },
              {
                action: "stashDrop",
                label: "Drop",
                past: "Dropped",
                detail: "Permanently remove this stash.",
                icon: "icon-trashcan",
              },
            ],
            onConfirm: (action, isCurrent) =>
              this.runOperation(
                repository,
                action.action,
                (operations) => operations[action.action](stash.reference),
                `${action.past} ${stash.reference}`,
                isCurrent,
              ),
          });
          return false;
        },
      },
      async () => {
        const result = await this.runRaw(repository, [
          "stash",
          "list",
          "--format=%gd%x00%cr%x00%s",
        ]);
        return parseStashes(result.stdout);
      },
    );
  }

  run({ context, crumb } = {}) {
    const repository = this.getRepository(context);
    if (!repository) return;
    this.modals.showInput({
      crumb,
      infoMessage: "Enter arguments after git",
      placeholderText: "status --short",
      onConfirm: async (input, dialog, isCurrent) => {
        let args;
        try {
          args = parseCommandLine(input);
          if (args[0]?.toLowerCase() === "git") args.shift();
          if (args.length === 0) throw new Error("Enter at least one Git argument.");
        } catch (error) {
          await dialog.update({ status: { type: "error", message: error.message } });
          return false;
        }

        await dialog.update({ loadingMessage: "Running Git…" });
        let result;
        let failure;
        try {
          result = await repository.getOperations().executeGit(args);
        } catch (error) {
          if (typeof error.exitCode !== "number") throw error;
          failure = error;
          result = { stdout: error.stdout, stderr: error.stderr, exitCode: error.exitCode };
        }
        if (!isCurrent()) return false;
        const content = [result.stdout, result.stderr].filter(Boolean).join("\n");
        await this.showOutput(
          repository,
          `run:${args.join(" ")}`,
          `git ${args.join(" ")}`,
          content || `Process exited with code ${result.exitCode}.`,
        );
        if (failure || result.exitCode !== 0) {
          await dialog.update({
            loadingMessage: null,
            status: { type: "error", message: `Git exited with code ${result.exitCode}.` },
          });
          return false;
        }
        return true;
      },
    });
  }

  errorMessage(error) {
    const detail = String(error?.stderr || error?.message || error || "Unknown Git error").trim();
    return error?.outcome === "unknown"
      ? `The write outcome is unknown. Refresh the repository before repeating it. ${detail}`
      : detail;
  }

  reportError(action, error) {
    lumine.notifications.addError(`Git ${action} failed`, {
      detail: this.errorMessage(error),
      dismissable: true,
    });
    return false;
  }

  destroy() {
    this.destroyed = true;
    this.diffRequests.clear();
    this.commitRequest++;
    this.patchView = null;
    this.modals.destroy();
    this.outputs.destroy();
  }
};
