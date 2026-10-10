const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

describe("Quick commit current-file scope", () => {
  let root, scratch, repository, editor, controller, pack;

  beforeEach(async () => {
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.returnValue(Promise.resolve());
    spyOn(lumine.application, "openWindow").and.returnValue(Promise.resolve());
    lumine.config.set("git.protectCommits", false);
    root = await fs.realpath(os.tmpdir());
    scratch = await fs.realpath(await fs.mkdtemp(path.join(root, "git-quick-scope-")));
    const hooks = path.join(scratch, "empty-hooks");
    await fs.mkdir(hooks);
    repository = await lumine.repositories.initialize(scratch, { initialBranch: "main" });
    const operations = repository.getOperations();
    await operations.setConfig("core.hooksPath", hooks);
    await operations.setConfig("user.name", "Owned Quick Commit");
    await operations.setConfig("user.email", "quick@example.invalid");
    await operations.setConfig("commit.gpgSign", "false");
    await operations.setConfig("core.autocrlf", "false");
    await fs.writeFile(path.join(scratch, "active.txt"), "active baseline\n");
    await fs.writeFile(path.join(scratch, "other.txt"), "other baseline\n");
    await fs.writeFile(path.join(scratch, "[a].txt"), "bracket baseline\n");
    await fs.writeFile(path.join(scratch, "a.txt"), "a baseline\n");
    await operations.stageFiles(["active.txt", "other.txt", "[a].txt", "a.txt"]);
    await operations.commit("Owned baseline");
    await fs.writeFile(path.join(scratch, "other.txt"), "other staged change\n");
    await operations.stageFiles(["other.txt"]);
    editor = await lumine.workspace.open(path.join(scratch, "active.txt"));
    jasmine.attachToDOM(lumine.workspace.getElement());
    lumine.repositories.setActiveRepository(repository, { pin: true });
    await lumine.packages.activatePackage("git-panel");
    await lumine.packages.activatePackage("git-command");
    pack = lumine.packages.getActivePackage("git-command");
    controller = pack.mainModule.ensureController();
  });

  afterEach(async () => {
    lumine.repositories.setActiveRepository(null);
    await lumine.packages.deactivatePackage("git-command");
    await lumine.packages.deactivatePackage("git-panel");
    if (lumine.packages.isPackageLoaded("git-command"))
      await lumine.packages.unloadPackage("git-command");
    editor?.destroy();
    if (repository) lumine.repositories.forget(repository);
    await lumine.fileWatchClient.settlePendingTeardown();
    lumine.config.unset("git.protectCommits");
    if (scratch) {
      const resolved = await fs.realpath(scratch);
      const relative = path.relative(root, resolved);
      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        throw new Error("Fixture cleanup escaped its owned temporary root.");
      await fs.rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
    root = scratch = repository = editor = controller = pack = null;
  });

  async function git(args) {
    return (await repository.getOperations().executeGit(args, { readOnly: true })).stdout;
  }

  async function confirm(command) {
    await lumine.commands.dispatch(editor.getElement(), command);
    expect(controller.modals.inputDialogHost.isVisible()).toBe(true);
    await controller.modals.inputDialog.setQuery("Owned selected change");
    await lumine.commands.dispatch(controller.modals.inputDialog.getElement(), "core:confirm");
    expect((await repository.getCommit("HEAD")).subject).toBe("Owned selected change");
  }

  async function expectOnlyCurrentCommitted(file, contents) {
    expect((await git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])).trim()).toBe(
      file,
    );
    expect(await git(["show", `HEAD:${file}`])).toBe(contents);
    expect(await git(["show", "HEAD:other.txt"])).toBe("other baseline\n");
    expect((await git(["diff", "--cached", "--name-only"])).trim()).toBe("other.txt");
    expect(await git(["show", ":other.txt"])).toBe("other staged change\n");
  }

  it("commits a modified current file and preserves unrelated staged changes", async () => {
    editor.setText("active selected change\n");
    await editor.save();
    await confirm("git-command:quick-commit-current-file");
    await expectOnlyCurrentCommitted("active.txt", "active selected change\n");
  });

  it("commits a newly added current file and preserves unrelated staged changes", async () => {
    editor.destroy();
    const file = path.join(scratch, "added.txt");
    await fs.writeFile(file, "new selected file\n");
    editor = await lumine.workspace.open(file);
    await confirm("git-command:quick-commit-current-file");
    await expectOnlyCurrentCommitted("added.txt", "new selected file\n");
  });

  it("keeps the ordinary commit action including every staged file", async () => {
    editor.setText("active selected change\n");
    await editor.save();
    await repository.getOperations().stageFiles(["active.txt"]);
    await confirm("git-command:commit");
    expect(
      (await git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])).trim().split("\n"),
    ).toEqual(["active.txt", "other.txt"]);
    expect(await git(["show", "HEAD:other.txt"])).toBe("other staged change\n");
    expect((await git(["diff", "--cached", "--name-only"])).trim()).toBe("");
  });

  it("treats the current filename as a literal path rather than a Git pathspec", async () => {
    await fs.writeFile(path.join(scratch, "a.txt"), "a staged change\n");
    await repository.getOperations().stageFiles(["a.txt"]);
    editor.destroy();
    editor = await lumine.workspace.open(path.join(scratch, "[a].txt"));
    editor.setText("bracket selected change\n");
    await editor.save();
    await confirm("git-command:quick-commit-current-file");
    expect((await git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])).trim()).toBe(
      "[a].txt",
    );
    expect(await git(["show", "HEAD:[a].txt"])).toBe("bracket selected change\n");
    expect(await git(["show", "HEAD:a.txt"])).toBe("a baseline\n");
    expect((await git(["diff", "--cached", "--name-only"])).trim().split("\n")).toEqual([
      "a.txt",
      "other.txt",
    ]);
    expect(await git(["show", ":a.txt"])).toBe("a staged change\n");
  });
});
