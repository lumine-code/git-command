const fs = require("fs");
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

module.exports = class Controller {
  constructor() {
    this.modals = new ModalManager();
    this.outputs = new OutputManager();
  }

  perform(action, options = {}) {
    const method = ACTION_METHODS[action];
    if (!method || typeof this[method] !== "function") {
      return Promise.reject(new Error(`Unknown Git action: ${action}`));
    }
    return Promise.resolve(this[method](options)).catch((error) => this.reportError(action, error));
  }

  getRepository() {
    const editorPath = atom.workspace.getActiveTextEditor()?.getPath();
    const repository =
      (editorPath && atom.repositories.getForPath(editorPath)) ||
      atom.repositories.getActiveRepository() ||
      atom.repositories.getRepositories()[0];
    if (!repository) {
      atom.notifications.addInfo("No Git repository is open.");
      return null;
    }
    return repository;
  }

  getOperations(repository, operationName) {
    const operations = repository?.getOperations?.();
    if (!operations?.isAvailable(operationName)) {
      atom.notifications.addError(`Git ${operationName} is unavailable`, {
        description: "The active repository has no provider for this operation.",
        dismissable: true,
      });
      return null;
    }
    return operations;
  }

  getCurrentFile(repository) {
    const filePath = atom.workspace.getActiveTextEditor()?.getPath();
    if (!filePath || atom.repositories.getForPath(filePath) !== repository) {
      atom.notifications.addInfo("The active editor is not a file in this repository.");
      return null;
    }
    return {
      absolute: filePath,
      relative: repository.posixRelativePath(filePath),
    };
  }

  async runRaw(repository, args, options = {}) {
    const result = await atom.repositories.executeGit(
      args,
      repository.getWorkingDirectory(),
      options,
    );
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

  async runOperation(repository, operationName, callback, successMessage) {
    const operations = this.getOperations(repository, operationName);
    if (!operations) return false;
    await callback(operations);
    if (successMessage) atom.notifications.addSuccess(successMessage);
    return true;
  }

  async showOutput(repository, key, title, content) {
    return this.outputs.show(`${repository.getWorkingDirectory()}:${key}`, {
      title,
      subtitle: repositoryName(repository),
      content,
    });
  }

  async showStatus() {
    const repository = this.getRepository();
    if (!repository) return;
    const snapshot = await repository.ensureStatusSnapshot();
    await this.showOutput(repository, "status", "Git Status", formatStatus(snapshot, repository));
  }

  async stageCurrentFile() {
    const repository = this.getRepository();
    const file = repository && this.getCurrentFile(repository);
    if (!file) return;
    await this.runOperation(
      repository,
      "stageFiles",
      (operations) => operations.stageFiles([file.relative]),
      `Staged ${file.relative}`,
    );
  }

  async stageAll() {
    const repository = this.getRepository();
    if (!repository) return;
    await this.runOperation(
      repository,
      "stageFiles",
      (operations) => operations.stageFiles(["."]),
      "Staged all changes",
    );
  }

  async unstageCurrentFile() {
    const repository = this.getRepository();
    const file = repository && this.getCurrentFile(repository);
    if (!file) return;
    await this.runOperation(
      repository,
      "unstageFiles",
      (operations) => operations.unstageFiles([file.relative]),
      `Unstaged ${file.relative}`,
    );
  }

  async unstageAll() {
    const repository = this.getRepository();
    if (!repository) return;
    await this.runOperation(
      repository,
      "unstageFiles",
      (operations) => operations.unstageFiles(["."]),
      "Unstaged all changes",
    );
  }

  async diffText(repository, paths = []) {
    const suffix = paths.length ? ["--", ...paths] : [];
    const [staged, unstaged, snapshot] = await Promise.all([
      this.runRaw(repository, ["diff", "--cached", "--no-ext-diff", ...suffix]),
      repository.getDiff({ paths }),
      repository.ensureStatusSnapshot(),
    ]);
    const sections = [];
    if (staged.stdout.trim())
      sections.push(`Staged changes\n${"=".repeat(14)}\n\n${staged.stdout}`);
    if (unstaged.rawPatch.trim()) {
      sections.push(`Unstaged changes\n${"=".repeat(16)}\n\n${unstaged.rawPatch}`);
    }
    const pathSet = new Set(paths);
    const untracked = snapshot.files.filter(
      (entry) => entry.untracked && (pathSet.size === 0 || pathSet.has(entry.path)),
    );
    for (const entry of untracked) {
      const filePath = path.join(repository.getWorkingDirectory(), entry.path);
      try {
        const contents = fs.readFileSync(filePath, "utf8");
        const preview = contents.length > 12_000 ? `${contents.slice(0, 12_000)}\n…` : contents;
        sections.push(
          `Untracked: ${entry.path}\n${"=".repeat(entry.path.length + 11)}\n\n${preview}`,
        );
      } catch {
        sections.push(`Untracked: ${entry.path}`);
      }
    }
    return sections.join("\n\n") || "No changes.";
  }

  async diffCurrentFile() {
    const repository = this.getRepository();
    const file = repository && this.getCurrentFile(repository);
    if (!file) return;
    await this.showOutput(
      repository,
      `diff:${file.relative}`,
      `Diff: ${file.relative}`,
      await this.diffText(repository, [file.relative]),
    );
  }

  async diffAll() {
    const repository = this.getRepository();
    if (!repository) return;
    await this.showOutput(repository, "diff", "Git Diff", await this.diffText(repository));
  }

  async log() {
    const repository = this.getRepository();
    if (!repository) return;
    const page = await repository.getCommits({ limit: atom.config.get("git-command.logLimit") });
    await this.showOutput(repository, "log", "Git Log", formatCommits(page.commits));
  }

  async logCurrentFile() {
    const repository = this.getRepository();
    const file = repository && this.getCurrentFile(repository);
    if (!file) return;
    const page = await repository.getCommits({
      path: file.relative,
      limit: atom.config.get("git-command.logLimit"),
    });
    await this.showOutput(
      repository,
      `log:${file.relative}`,
      `History: ${file.relative}`,
      formatCommits(page.commits),
    );
  }

  async blameCurrentFile() {
    const repository = this.getRepository();
    const file = repository && this.getCurrentFile(repository);
    if (!file) return;
    const blame = await repository.getBlame(file.relative);
    await this.showOutput(
      repository,
      `blame:${file.relative}`,
      `Blame: ${file.relative}`,
      formatBlame(blame),
    );
  }

  async openChangedFiles() {
    const repository = this.getRepository();
    if (!repository) return;
    const snapshot = await repository.ensureStatusSnapshot();
    const paths = snapshot.files
      .map((entry) => path.join(repository.getWorkingDirectory(), entry.path))
      .filter((filePath) => fs.existsSync(filePath));
    await Promise.all(
      paths.map((filePath) => atom.workspace.open(filePath, { activatePane: false })),
    );
    atom.notifications.addSuccess(
      `Opened ${paths.length} changed ${paths.length === 1 ? "file" : "files"}`,
    );
  }

  async restoreCurrentFile() {
    const repository = this.getRepository();
    const file = repository && this.getCurrentFile(repository);
    if (!file) return;
    const answer = atom.confirm({
      message: `Restore ${file.relative}?`,
      detailedMessage: "This discards both staged and unstaged changes to the file.",
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

  async isProtected(repository, kind) {
    const enabled = atom.config.get(
      kind === "commit" ? "git-command.protectCommits" : "git-command.protectPushes",
    );
    if (!enabled) return false;
    const refs = await repository.ensureRefsSnapshot();
    const branch = refs.head?.name;
    const protectedBranches = atom.config.get("git-command.protectedBranches") || [];
    if (!branch || !protectedBranches.includes(branch)) return false;
    atom.notifications.addWarning(
      `${kind === "commit" ? "Commits" : "Pushes"} are blocked on ${branch}`,
      {
        description: "Change the protected-branch settings to allow this action.",
        dismissable: true,
      },
    );
    return true;
  }

  async commitDialog({ crumb, stageAll = false, currentFile = null, amend = false }) {
    const repository = this.getRepository();
    if (!repository || (await this.isProtected(repository, "commit"))) return;
    const paths = currentFile ? [currentFile.relative] : [];
    const preview = await this.diffText(repository, paths);
    let query = "";
    if (amend) {
      const previous = await repository.getCommit("HEAD");
      query = previous ? [previous.subject, previous.body].filter(Boolean).join("\n\n") : "";
    }

    this.modals.showInput({
      crumb,
      query,
      preview,
      infoMessage: amend ? "Edit the amended commit message" : "Enter a commit message",
      placeholderText: "Commit message",
      onConfirm: async (message, dialog) => {
        const operations = this.getOperations(repository, "commit");
        if (!operations) return false;
        await dialog.update({ loadingMessage: "Creating commit…", loadingSpinner: true });
        try {
          if (stageAll) await operations.stageFiles(["."]);
          if (currentFile) await operations.stageFiles([currentFile.relative]);
          await operations.commit(message, { amend });
          atom.notifications.addSuccess(amend ? "Amended the latest commit" : "Created commit");
          return true;
        } catch (error) {
          await dialog.update({
            loadingMessage: null,
            loadingSpinner: false,
            errorMessage: this.errorMessage(error),
          });
          return false;
        }
      },
    });
  }

  commit({ crumb } = {}) {
    return this.commitDialog({ crumb });
  }

  stageAllAndCommit({ crumb } = {}) {
    return this.commitDialog({ crumb, stageAll: true });
  }

  quickCommitCurrentFile({ crumb } = {}) {
    const repository = this.getRepository();
    const currentFile = repository && this.getCurrentFile(repository);
    if (!currentFile) return undefined;
    return this.commitDialog({ crumb, currentFile });
  }

  amend({ crumb } = {}) {
    return this.commitDialog({ crumb, amend: true });
  }

  async branchSelection(operationName, crumb) {
    const repository = this.getRepository();
    if (!repository) return;
    await this.modals.showSelection({
      items: [],
      loadingMessage: "Loading branches…",
      emptyMessage: "No other local branches",
      crumb,
      onConfirm: async (item) =>
        this.runOperation(
          repository,
          operationName,
          (operations) => {
            if (operationName === "checkout") return operations.checkout(item.branch);
            return operations[operationName](item.branch);
          },
          `${operationName === "checkout" ? "Checked out" : `${operationName}d`} ${item.branch}`,
        ),
    });
    const refs = await repository.ensureRefsSnapshot();
    const items = refs.branches
      .filter((branch) => !branch.isHead)
      .map((branch) => ({
        branch: branch.name,
        label: branch.name,
        detail: branch.upstream?.name || "Local branch",
        icon: "icon-git-branch",
        searchText: `${branch.name} ${branch.upstream?.name || ""}`,
      }));
    await this.modals.updateSelection(items);
  }

  checkout({ crumb } = {}) {
    return this.branchSelection("checkout", crumb);
  }

  merge({ crumb } = {}) {
    return this.branchSelection("merge", crumb);
  }

  rebase({ crumb } = {}) {
    return this.branchSelection("rebase", crumb);
  }

  newBranch({ crumb } = {}) {
    const repository = this.getRepository();
    if (!repository) return;
    this.modals.showInput({
      crumb,
      infoMessage: "Create a branch from the current HEAD",
      placeholderText: "Branch name",
      onConfirm: (name) =>
        this.runOperation(
          repository,
          "checkout",
          (operations) => operations.checkout(name, { createNew: true }),
          `Created and checked out ${name}`,
        ),
    });
  }

  async cherryPick({ crumb } = {}) {
    const repository = this.getRepository();
    if (!repository) return;
    await this.modals.showSelection({
      items: [],
      loadingMessage: "Loading commits…",
      emptyMessage: "No commits available",
      crumb,
      onConfirm: (item) =>
        this.runOperation(
          repository,
          "cherryPick",
          (operations) => operations.cherryPick(item.sha),
          `Cherry-picked ${item.sha.slice(0, 8)}`,
        ),
    });
    const page = await repository.getCommits({
      revision: "--all",
      limit: atom.config.get("git-command.logLimit"),
    });
    await this.modals.updateSelection(
      page.commits.map((commit) => ({
        sha: commit.sha,
        label: commit.subject,
        detail: `${commit.sha.slice(0, 8)} · ${commit.author.name}`,
        icon: "icon-git-commit",
        searchText: `${commit.sha} ${commit.subject} ${commit.author.name}`,
      })),
    );
  }

  async fetch({ crumb } = {}) {
    const repository = this.getRepository();
    if (!repository) return;
    await this.modals.showSelection({
      items: [],
      loadingMessage: "Loading remotes…",
      emptyMessage: "No remotes configured",
      crumb,
      onConfirm: (item) =>
        this.runOperation(
          repository,
          "fetch",
          (operations) => operations.fetch(item.remote, null, { prune: true }),
          `Fetched ${item.remote}`,
        ),
    });
    const refs = await repository.ensureRefsSnapshot();
    await this.modals.updateSelection(
      refs.remotes.map((remote) => ({
        remote: remote.name,
        label: remote.name,
        detail: remote.fetchUrl,
        icon: "icon-cloud-download",
        searchText: `${remote.name} ${remote.fetchUrl || ""}`,
      })),
    );
  }

  async fetchAll() {
    const repositories = atom.repositories.getRepositories();
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
    atom.notifications.addSuccess(`Fetched ${fetched} ${fetched === 1 ? "remote" : "remotes"}`);
  }

  async pull() {
    const repository = this.getRepository();
    if (!repository) return;
    await this.runOperation(
      repository,
      "pull",
      (operations) =>
        operations.pull(null, null, { rebase: atom.config.get("git-command.pullRebase") }),
      "Pulled the current branch",
    );
  }

  async push({ crumb } = {}) {
    const repository = this.getRepository();
    if (!repository || (await this.isProtected(repository, "push"))) return;
    const refs = await repository.ensureRefsSnapshot();
    const branch = refs.branches.find((entry) => entry.isHead);
    if (!branch) {
      atom.notifications.addInfo("The repository is not on a local branch.");
      return;
    }

    const target = branch.push?.name || branch.upstream?.name;
    if (target?.includes("/")) {
      const remote = target.slice(0, target.indexOf("/"));
      await this.pushTo(repository, branch.name, remote, false);
      return;
    }

    if (refs.remotes.length === 1) {
      await this.pushTo(repository, branch.name, refs.remotes[0].name, true);
      return;
    }

    await this.modals.showSelection({
      items: refs.remotes.map((remote) => ({
        remote: remote.name,
        label: remote.name,
        detail: remote.pushUrl || remote.fetchUrl,
        icon: "icon-cloud-upload",
        searchText: `${remote.name} ${remote.pushUrl || remote.fetchUrl || ""}`,
      })),
      emptyMessage: "No remotes configured",
      crumb,
      onConfirm: (item) => this.pushTo(repository, branch.name, item.remote, true),
    });
  }

  pushTo(repository, branch, remote, setUpstream) {
    return this.runOperation(
      repository,
      "push",
      (operations) => operations.push(remote, branch, { setUpstream }),
      `Pushed ${branch} to ${remote}`,
    );
  }

  stash({ crumb } = {}) {
    const repository = this.getRepository();
    if (!repository) return;
    this.modals.showInput({
      crumb,
      allowEmpty: true,
      infoMessage: "Enter an optional stash message",
      placeholderText: "Stash message",
      onConfirm: (message) =>
        this.runOperation(
          repository,
          "stashPush",
          (operations) =>
            operations.stashPush({
              message: message || undefined,
              includeUntracked: atom.config.get("git-command.stashIncludeUntracked"),
            }),
          "Stashed working-tree changes",
        ),
    });
  }

  async manageStashes({ crumb } = {}) {
    const repository = this.getRepository();
    if (!repository) return;
    await this.modals.showSelection({
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
          onConfirm: (action) =>
            this.runOperation(
              repository,
              action.action,
              (operations) => operations[action.action](stash.reference),
              `${action.past} ${stash.reference}`,
            ),
        });
        return false;
      },
    });
    const result = await this.runRaw(repository, ["stash", "list", "--format=%gd%x00%cr%x00%s"]);
    await this.modals.updateSelection(parseStashes(result.stdout));
  }

  run({ crumb } = {}) {
    const repository = this.getRepository();
    if (!repository) return;
    this.modals.showInput({
      crumb,
      infoMessage: "Enter arguments after git",
      placeholderText: "status --short",
      onConfirm: async (input, dialog) => {
        let args;
        try {
          args = parseCommandLine(input);
          if (args[0]?.toLowerCase() === "git") args.shift();
          if (args.length === 0) throw new Error("Enter at least one Git argument.");
        } catch (error) {
          await dialog.update({ errorMessage: error.message });
          return false;
        }

        await dialog.update({ loadingMessage: "Running Git…", loadingSpinner: true });
        const result = await atom.repositories.executeGit(args, repository.getWorkingDirectory());
        const content = [result.stdout, result.stderr].filter(Boolean).join("\n");
        await this.showOutput(
          repository,
          `run:${args.join(" ")}`,
          `git ${args.join(" ")}`,
          content || `Process exited with code ${result.exitCode}.`,
        );
        await Promise.all([
          repository.refreshStatusSnapshot?.().catch(() => null),
          repository.refreshRefsSnapshot?.().catch(() => null),
        ]);
        if (result.exitCode !== 0) {
          await dialog.update({
            loadingMessage: null,
            loadingSpinner: false,
            errorMessage: `Git exited with code ${result.exitCode}.`,
          });
          return false;
        }
        return true;
      },
    });
  }

  errorMessage(error) {
    return String(error?.stderr || error?.message || error || "Unknown Git error").trim();
  }

  reportError(action, error) {
    atom.notifications.addError(`Git ${action} failed`, {
      detail: this.errorMessage(error),
      dismissable: true,
    });
    return false;
  }

  destroy() {
    this.modals.destroy();
    this.outputs.destroy();
  }
};
