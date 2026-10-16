const FILE_ACTIONS = require("./action-scope");
const commandContext = require("./command-context");

const OPERATIONS = {
  "stage-current-file": ["stageFiles"],
  "stage-all": ["stageFiles"],
  "unstage-current-file": ["unstageFiles"],
  "unstage-all": ["unstageFiles"],
  commit: ["commit"],
  "stage-all-and-commit": ["stageFiles", "commit"],
  "quick-commit-current-file": ["stageFiles", "commit"],
  amend: ["commit"],
  "restore-current-file": ["checkoutFiles"],
  checkout: ["checkout"],
  "new-branch": ["checkout"],
  merge: ["merge"],
  rebase: ["rebase"],
  "cherry-pick": ["cherryPick"],
  fetch: ["fetch"],
  pull: ["pull"],
  push: ["push"],
  stash: ["stashPush"],
  run: ["executeGit"],
};

function live(repository) {
  return Boolean(repository && !repository.isDestroyed?.());
}

function hasRemote(repository) {
  const refs = repository.getRefsSnapshot?.();
  return !refs?.initialized || refs.remotes.length > 0;
}

function currentRemoteAvailable(repository, action) {
  const refs = repository.getRefsSnapshot?.();
  if (!refs?.initialized) return true;
  const branch = refs.branches.find((entry) => entry.isHead);
  if (!branch) return false;
  const validTarget = (target) =>
    Boolean(
      target?.ref?.startsWith("refs/heads/") ||
      refs.remotes.some(({ name }) =>
        (target?.ref?.startsWith("refs/remotes/")
          ? target.ref.slice(13)
          : target?.name || ""
        ).startsWith(`${name}/`),
      ),
    );
  if (action === "pull") return validTarget(branch.upstream);
  return validTarget(branch.push) || validTarget(branch.upstream) || refs.remotes.length > 0;
}

function isActionAvailable(action, event) {
  if (action === "fetch-all")
    return lumine.repositories
      .getRepositories()
      .some(
        (repository) =>
          live(repository) &&
          repository.getOperations?.().isAvailable("fetch") &&
          hasRemote(repository),
      );
  const file = FILE_ACTIONS.has(action);
  const context = commandContext(event, file ? "file" : "repository");
  const { repository, editor, path } = context;
  if (!live(repository) || (file && (!editor || editor.isDestroyed?.() || !path))) return false;
  const operations = repository.getOperations?.();
  if ((OPERATIONS[action] ?? []).some((name) => !operations?.isAvailable(name))) return false;
  if (action === "fetch" && !hasRemote(repository)) return false;
  if (["pull", "push"].includes(action) && !currentRemoteAvailable(repository, action))
    return false;
  const status = repository.getStatusSnapshot?.();
  if (!status?.initialized) return true;
  const entry = file ? repository.getStatusEntry?.(path) : null;
  const counts = status.counts;
  const actionableChanges = counts.staged + counts.unstaged + counts.conflicted;
  switch (action) {
    case "stage-current-file":
      return Boolean(entry?.unstaged || entry?.conflicted);
    case "unstage-current-file":
      return Boolean(entry?.staged);
    case "quick-commit-current-file":
      return Boolean(
        entry && counts.conflicted === 0 && !entry.conflicted && (entry.staged || entry.unstaged),
      );
    case "restore-current-file":
      return Boolean(
        status.head?.oid &&
        entry &&
        !entry.untracked &&
        entry.indexStatus !== "A" &&
        !entry.originalPath &&
        (entry.staged || entry.unstaged || entry.conflicted),
      );
    case "diff-current-file":
      return Boolean(entry?.staged || entry?.unstaged || entry?.conflicted);
    case "stage-all":
      return counts.unstaged + counts.conflicted > 0;
    case "unstage-all":
      return counts.staged > 0;
    case "commit":
      return counts.staged > 0 && counts.conflicted === 0;
    case "stage-all-and-commit":
      return actionableChanges > 0 && counts.conflicted === 0;
    case "diff-all":
    case "open-changed-files":
      return actionableChanges > 0;
    case "stash":
      return Boolean(
        status.head?.oid &&
        counts.conflicted === 0 &&
        counts.staged +
          counts.unstaged -
          (lumine.config.get("git-command.stashIncludeUntracked") === false
            ? (counts.untracked ?? 0)
            : 0) >
          0,
      );
    case "amend":
    case "log":
    case "log-current-file":
    case "cherry-pick":
    case "merge":
    case "rebase":
    case "push":
    case "pull":
      return Boolean(status.head?.oid);
    case "blame-current-file":
      return Boolean(
        status.head?.oid && !entry?.untracked && !entry?.ignored && entry?.indexStatus !== "A",
      );
    default:
      return true;
  }
}

module.exports = isActionAvailable;
