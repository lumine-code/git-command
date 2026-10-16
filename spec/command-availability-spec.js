const isActionAvailable = require("../lib/command-availability");

describe("Git Command availability", () => {
  let repository, status, refs, entry, context, operations;
  beforeEach(() => {
    status = {
      initialized: true,
      head: { oid: "commit" },
      counts: { total: 0, staged: 0, unstaged: 0, conflicted: 0 },
    };
    refs = { initialized: true, remotes: [], branches: [{ isHead: true, name: "main" }] };
    operations = { isAvailable: jasmine.createSpy("operation capability").and.returnValue(true) };
    repository = {
      isDestroyed: () => false,
      getStatusSnapshot: () => status,
      getRefsSnapshot: () => refs,
      getStatusEntry: () => entry,
      getOperations: () => operations,
    };
    context = { repository, editor: { isDestroyed: () => false }, path: "/project/file" };
    spyOn(lumine.repositories, "getCommandContext").and.callFake(() => context);
    spyOn(lumine.repositories, "getRepositories").and.callFake(() =>
      repository ? [repository] : [],
    );
  });
  afterEach(() => {
    lumine.repositories.getCommandContext.and.callThrough();
    lumine.repositories.getRepositories.and.callThrough();
    if (jasmine.isSpy(lumine.repositories.getForPath))
      lumine.repositories.getForPath.and.callThrough();
  });

  it("disables repository and file actions without a repository", () => {
    context.repository = null;
    repository = null;
    for (const action of [
      "status",
      "commit",
      "stage-all",
      "stage-current-file",
      "fetch",
      "fetch-all",
      "run",
    ])
      expect(isActionAvailable(action, {})).withContext(action).toBe(false);
  });

  it("distinguishes clean, unstaged, staged and conflicting changes", () => {
    expect(isActionAvailable("status", {})).toBe(true);
    expect(isActionAvailable("commit", {})).toBe(false);
    expect(isActionAvailable("stage-all", {})).toBe(false);
    status.counts = { total: 1, staged: 0, unstaged: 1, conflicted: 0 };
    expect(isActionAvailable("stage-all", {})).toBe(true);
    expect(isActionAvailable("commit", {})).toBe(false);
    status.counts = { total: 1, staged: 1, unstaged: 0, conflicted: 0 };
    expect(isActionAvailable("commit", {})).toBe(true);
    status.counts.conflicted = 1;
    expect(isActionAvailable("commit", {})).toBe(false);
  });

  it("uses file state and provider capability for operations on the current file", () => {
    entry = { unstaged: true, staged: false };
    expect(isActionAvailable("stage-current-file", {})).toBe(true);
    expect(isActionAvailable("unstage-current-file", {})).toBe(false);
    operations.isAvailable.and.returnValue(false);
    expect(isActionAvailable("stage-current-file", {})).toBe(false);
    operations.isAvailable.and.returnValue(true);
    context.path = null;
    expect(isActionAvailable("stage-current-file", {})).toBe(false);
  });

  it("does not treat ignored-only files or excluded untracked files as actionable changes", () => {
    const { parseStatusSnapshot } = require(
      require("node:path").join(
        lumine.application.getResourcePath(),
        "src/repository-status-snapshot",
      ),
    );
    const head = `# branch.oid ${"a".repeat(40)}\0# branch.head main\0`;
    status = parseStatusSnapshot(`${head}! build/\0`, { includesIgnored: true });
    for (const action of ["stage-all-and-commit", "diff-all", "open-changed-files", "stash"])
      expect(isActionAvailable(action, {})).withContext(action).toBe(false);
    status = parseStatusSnapshot(`${head}? new-file.txt\0`, { includesIgnored: true });
    lumine.config.set("git-command.stashIncludeUntracked", false);
    expect(isActionAvailable("stash", {})).toBe(false);
    lumine.config.set("git-command.stashIncludeUntracked", true);
    expect(isActionAvailable("stash", {})).toBe(true);
  });

  it("requires known remotes but leaves uninitialized caches loadable", () => {
    expect(isActionAvailable("fetch", {})).toBe(false);
    refs.remotes = [{ name: "origin" }];
    expect(isActionAvailable("fetch", {})).toBe(true);
    status.head.oid = null;
    expect(isActionAvailable("push", {})).toBe(false);
    status.initialized = false;
    refs.initialized = false;
    expect(isActionAvailable("push", {})).toBe(true);
  });

  it("does not restore paths absent from HEAD or partially commit while other files conflict", () => {
    entry = { staged: false, unstaged: true };
    expect(isActionAvailable("restore-current-file", {})).toBe(true);
    entry = { ignored: true };
    expect(isActionAvailable("blame-current-file", {})).toBe(false);
    entry.untracked = true;
    expect(isActionAvailable("restore-current-file", {})).toBe(false);
    entry = { staged: true, indexStatus: "A" };
    expect(isActionAvailable("restore-current-file", {})).toBe(false);
    entry = { staged: true, indexStatus: "R", originalPath: "old-name.txt" };
    expect(isActionAvailable("restore-current-file", {})).toBe(false);
    entry = { unstaged: true };
    expect(isActionAvailable("quick-commit-current-file", {})).toBe(true);
    status.counts.conflicted = 1;
    expect(isActionAvailable("quick-commit-current-file", {})).toBe(false);
  });

  it("requires an active branch and upstream for pull but allows the push remote picker", () => {
    refs.remotes = [{ name: "first" }, { name: "second" }];
    expect(isActionAvailable("fetch", {})).toBe(true);
    expect(isActionAvailable("pull", {})).toBe(false);
    expect(isActionAvailable("push", {})).toBe(true);
    refs.branches[0].upstream = { ref: "refs/remotes/second/main" };
    expect(isActionAvailable("pull", {})).toBe(true);
    refs.remotes = [];
    refs.branches[0].upstream = { ref: "refs/heads/local" };
    expect(isActionAvailable("pull", {})).toBe(true);
    expect(isActionAvailable("push", {})).toBe(true);
    refs.branches = [];
    expect(isActionAvailable("pull", {})).toBe(false);
    expect(isActionAvailable("push", {})).toBe(false);
  });

  it("uses the backing document for whole-file operations in an embedded editor", () => {
    const fileEditor = { getPath: () => "/project/notebook.ipynb", isDestroyed: () => false };
    entry = { unstaged: true };
    spyOn(lumine.repositories, "getForPath").and.callFake((path) =>
      path === fileEditor.getPath() ? repository : null,
    );
    expect(isActionAvailable("stage-current-file", { context: { fileEditor } })).toBe(true);
    expect(lumine.repositories.getForPath).toHaveBeenCalledWith("/project/notebook.ipynb");
  });
});
