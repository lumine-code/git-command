const path = require("path");

function repositoryName(repository) {
  return path.basename(repository.getWorkingDirectory());
}

function formatStatus(snapshot, repository) {
  const head = snapshot.head || {};
  const branch = head.detached
    ? `detached at ${(head.oid || "").slice(0, 7)}`
    : head.name || "(unborn branch)";
  const upstream = snapshot.upstream
    ? ` -> ${snapshot.upstream.name} (+${snapshot.upstream.ahead} -${snapshot.upstream.behind})`
    : "";
  const counts = snapshot.counts;
  const lines = [
    `${repositoryName(repository)}  ${branch}${upstream}`,
    `${counts.total} changed, ${counts.staged} staged, ${counts.unstaged} unstaged, ${counts.conflicted} conflicted`,
    "",
  ];

  for (const file of snapshot.files) {
    const index = file.untracked ? "?" : file.indexStatus || " ";
    const worktree = file.untracked ? "?" : file.worktreeStatus || " ";
    const rename = file.originalPath ? `${file.originalPath} -> ` : "";
    lines.push(`${index}${worktree} ${rename}${file.path}`);
  }

  if (snapshot.files.length === 0) lines.push("Working tree clean.");
  return lines.join("\n");
}

function formatCommits(commits) {
  if (commits.length === 0) return "No commits yet.";
  return commits
    .map((commit) => {
      const date = Number.isNaN(commit.author.date.getTime())
        ? ""
        : commit.author.date.toISOString().slice(0, 10);
      const header = `${commit.sha.slice(0, 10)}  ${date}  ${commit.author.name}`;
      return commit.body
        ? `${header}\n    ${commit.subject}\n\n${indent(commit.body, "    ")}`
        : `${header}\n    ${commit.subject}`;
    })
    .join("\n\n");
}

function formatBlame(blame) {
  if (blame.lines.length === 0) return "No blame information is available.";
  const authorWidth = Math.min(
    24,
    Math.max(6, ...blame.lines.map((entry) => (entry.author.name || "Unknown").length)),
  );
  return blame.lines
    .map((entry) => {
      const author = (entry.author.name || "Unknown").slice(0, authorWidth).padEnd(authorWidth);
      return `${String(entry.line).padStart(5)}  ${entry.sha.slice(0, 8)}  ${author}  ${entry.summary || ""}`;
    })
    .join("\n");
}

function parseStashes(output) {
  return String(output)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((record) => {
      const [reference, relativeDate, ...subject] = record.split("\0");
      return {
        reference,
        relativeDate,
        subject: subject.join("\0"),
        label: subject.join("\0") || reference,
        detail: `${reference} · ${relativeDate}`,
        icon: "icon-package",
        searchText: `${reference} ${relativeDate} ${subject.join(" ")}`,
      };
    });
}

function indent(text, prefix) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

module.exports = {
  formatBlame,
  formatCommits,
  formatStatus,
  parseStashes,
  repositoryName,
};
