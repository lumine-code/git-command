const fs = require("fs");
const os = require("os");
const path = require("path");
const { ACTIONS } = require("../lib/command-list");

describe("git-command", () => {
  let controller;
  let editor;
  let filePath;
  let main;
  let repository;
  let workingDirectory;
  let additionalRepositories;
  let additionalDirectories;

  beforeEach(async () => {
    lumine.config.set("git.protectCommits", false);
    lumine.config.set("git.protectPushes", false);
    additionalRepositories = [];
    additionalDirectories = [];
    workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "git-command-"));
    repository = await lumine.repositories.initialize(workingDirectory, { initialBranch: "main" });
    const operations = repository.getOperations();
    await operations.setConfig("user.name", "Git Command Specs");
    await operations.setConfig("user.email", "specs@lumine.invalid");

    filePath = path.join(workingDirectory, "example.txt");
    fs.writeFileSync(filePath, "initial\n");
    await operations.stageFiles(["example.txt"]);
    await operations.commit("Initial commit");

    editor = await lumine.workspace.open(filePath);
    jasmine.attachToDOM(lumine.workspace.getElement());
    const activation = lumine.packages.activatePackage("git-command");
    const opening = lumine.commands.dispatch(
      lumine.workspace.getElement(),
      "git-command:show-command-list",
    );
    await activation;
    await opening;
    main = lumine.packages.getActivePackage("git-command").mainModule;
    controller = main.controller;
    main.commandList.hide();
  });

  afterEach(async () => {
    lumine.repositories.setActiveRepository(null);
    await lumine.packages.deactivatePackage("command-palette");
    await lumine.packages.deactivatePackage("git-command");
    await lumine.packages.deactivatePackage("patch-view");
    for (const pane of lumine.workspace.getPanes()) {
      for (const item of pane.getItems()) {
        await pane.destroyItem(item, { force: true });
      }
    }
    lumine.repositories.forget(repository);
    for (const additional of additionalRepositories) lumine.repositories.forget(additional);
    lumine.config.unset("git.protectCommits");
    lumine.config.unset("git.protectPushes");
    try {
      fs.rmSync(workingDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      for (const directory of additionalDirectories) {
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
    } catch {
      // Windows can retain a short-lived worker handle after a Git operation.
    }
  });

  async function anotherRepository() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "git-command-context-"));
    additionalDirectories.push(directory);
    const additional = await lumine.repositories.initialize(directory, { initialBranch: "main" });
    additionalRepositories.push(additional);
    const operations = additional.getOperations();
    await operations.setConfig("user.name", "Git Command Specs");
    await operations.setConfig("user.email", "specs@lumine.invalid");
    const additionalPath = path.join(directory, "other.txt");
    fs.writeFileSync(additionalPath, "initial other\n");
    await operations.stageFiles(["other.txt"]);
    await operations.commit("Initial other commit");
    return { repository: additional, filePath: additionalPath, directory };
  }

  async function stagedNames(target) {
    const result = await target
      .getOperations()
      .executeGit(["diff", "--cached", "--name-only"], { readOnly: true });
    return result.stdout.trim();
  }

  it("registers its commands and opens the select list in a modal panel", () => {
    lumine.commands.dispatch(lumine.workspace.getElement(), "git-command:show-command-list");

    expect(main.commandList.selectListHost.isVisible()).toBe(true);
    expect(main.commandList.selectListHost.getPanel().isVisible()).toBe(true);
    expect(main.commandList.selectList.getElement().textContent).toContain(
      "Quick commit current file",
    );
    expect(main.commandList.selectList.getItems()).toEqual(jasmine.arrayWithExactContents(ACTIONS));
    expect(
      main.commandList.selectList.getElement().querySelectorAll(".select-list-separator").length,
    ).toBeGreaterThan(0);

    const commands = lumine.commands.findCommands({ target: lumine.workspace.getElement() });
    expect(commands.find(({ name }) => name === "git-command:show-command-list").modal).toBe(
      "Git command",
    );
    expect(commands.find(({ name }) => name === "git-command:commit").modal).toBe("Commit");
  });

  it("routes a dispatched action through the controller", () => {
    spyOn(controller, "perform").and.returnValue(Promise.resolve());

    lumine.commands.dispatch(lumine.workspace.getElement(), "git-command:stage-all");

    const [action, options] = controller.perform.calls.mostRecent().args;
    expect(action).toBe("stage-all");
    expect(options.event.target).toBe(lumine.workspace.getElement());
  });

  it("dispatches repository actions to pinned B and file actions to focused A", async () => {
    const other = await anotherRepository();
    editor.setText("change in focused A\n");
    await editor.save();
    fs.writeFileSync(other.filePath, "change in pinned B\n");
    lumine.repositories.setActiveRepository(other.repository, { pin: true });
    expect(lumine.workspace.getActiveTextEditor()).toBe(editor);
    await lumine.commands.dispatch(lumine.workspace.getElement(), "git-command:stage-all");
    expect(await stagedNames(other.repository)).toBe("other.txt");
    expect(await stagedNames(repository)).toBe("");
    await lumine.commands.dispatch(lumine.workspace.getElement(), "git-command:stage-current-file");
    expect(await stagedNames(repository)).toBe("example.txt");
    expect(lumine.repositories.getActiveRepository()).toBe(other.repository);
  });

  it("uses a non-active editor's dispatch target for file actions", async () => {
    const other = await anotherRepository();
    const originatingEditor = await lumine.workspace.open(other.filePath);
    originatingEditor.setText("change in originating editor\n");
    await originatingEditor.save();
    lumine.workspace.getActivePane().activateItem(editor);
    lumine.repositories.setActiveRepository(repository, { pin: true });
    await lumine.commands.dispatch(
      lumine.views.getView(originatingEditor),
      "git-command:stage-current-file",
    );
    expect(lumine.workspace.getActiveTextEditor()).toBe(editor);
    expect(await stagedNames(other.repository)).toBe("other.txt");
    expect(await stagedNames(repository)).toBe("");
  });

  it("coexists with the bundled Command Palette", async () => {
    const activation = lumine.packages.activatePackage("command-palette");
    const opening = lumine.commands.dispatch(
      lumine.workspace.getElement(),
      "command-palette:toggle",
    );
    const commandPalette = await activation;
    await opening;
    await lumine.views.getNextUpdatePromise();

    const { selectListHost, selectList } = commandPalette.mainModule.list;
    expect(selectListHost.isVisible()).toBe(true);
    expect(selectList.getItems().some(({ name }) => name === "git-command:show-command-list")).toBe(
      true,
    );
  });

  it("uses close and push primary actions for the two command kinds", async () => {
    const perform = spyOn(controller, "perform").and.returnValue(Promise.resolve());
    const host = main.commandList.selectListHost;
    const list = main.commandList.selectList;

    host.show();
    await list.selectItemById("stage-all");
    const closed = await list.confirmSelection();
    expect(closed.action.disposition).toBe("close");
    expect(perform).toHaveBeenCalledWith("stage-all", { crumb: "Stage all" });
    expect(host.isVisible()).toBe(false);

    host.show();
    await list.selectItemById("commit");
    const pushed = await list.confirmSelection();
    expect(pushed.action.disposition).toBe("push");
    expect(perform).toHaveBeenCalledWith("commit", { crumb: "Commit" });
    expect(host.isVisible()).toBe(true);
  });

  it("runs a live selection through its stable item action", async () => {
    const onConfirm = jasmine.createSpy("onConfirm").and.resolveTo(true);
    const item = {
      branch: "topic",
      label: "topic",
      detail: "Local branch",
      icon: "icon-git-branch",
    };

    await controller.modals.showSelection({ items: [item], onConfirm });
    const list = controller.modals.selectList;
    expect(list.getSelectedItemId()).toBe("branch:topic");
    const result = await list.confirmSelection();

    expect(result.action.disposition).toBe("stay");
    expect(onConfirm).toHaveBeenCalledWith(item);
    expect(controller.modals.selectListHost.isVisible()).toBe(false);
  });

  it("stages the active file through repository operations", async () => {
    editor.setText("changed\n");
    await editor.save();

    await controller.stageCurrentFile();

    const result = await lumine.repositories.executeGit(
      ["diff", "--cached", "--name-only"],
      workingDirectory,
    );
    expect(result.stdout.trim()).toBe("example.txt");
  });

  it("shows central status data in an output pane", async () => {
    editor.setText("changed\n");
    await editor.save();

    await controller.showStatus();

    const output = lumine.workspace.getActivePaneItem();
    expect(output.getTitle()).toBe("Git Status");
    expect(output.getElement().textContent).toContain("example.txt");
    expect(output.serialize).toBeUndefined();
  });

  it("renders the staged index separately from later worktree edits", async () => {
    editor.setText("staged\n");
    await editor.save();
    await repository.getOperations().stageFiles(["example.txt"]);
    editor.setText("worktree\n");
    await editor.save();

    const text = await controller.diffText(repository, ["example.txt"]);

    expect(text).toContain("Staged changes");
    expect(text).toContain("+staged");
    expect(text).toContain("Unstaged changes");
    expect(text).toContain("+worktree");
  });

  for (const method of ["diffCurrentFile", "diffAll"]) {
    it(`renders ${method} with separate snapshots in Unified and Side by Side`, async () => {
      await lumine.packages.activatePackage("patch-view");
      editor.setText("staged\n");
      await editor.save();
      await repository.getOperations().stageFiles(["example.txt"]);
      editor.setText("worktree\n");
      await editor.save();

      await controller[method]();
      const output = lumine.workspace.getActivePaneItem();
      const report = output.diffReport;
      expect(report.view.getDiffView()).toBe("unified");
      expect(report.view.props.readOnly).toBe(true);
      for (const mode of ["unified", "side-by-side"]) {
        await report.view.setDiffView(mode);
        await report.select("staged");
        expect(report.view.props.multiFilePatch.toString()).toContain("+staged");
        expect(report.view.props.multiFilePatch.toString()).not.toContain("+worktree");
        await report.select("unstaged");
        expect(report.view.props.multiFilePatch.toString()).toContain("-staged");
        expect(report.view.props.multiFilePatch.toString()).toContain("+worktree");
        expect(report.view.getDiffView()).toBe(mode);
        expect(report.element.querySelectorAll("lumine-text-editor").length).toBe(
          mode === "side-by-side" ? 2 : 1,
        );
      }
      lumine.workspace.getActivePane().activateItem(editor);
      await controller[method]();
      expect(lumine.workspace.getActivePaneItem()).toBe(output);
      expect(output.diffReport.selected).toBe("unstaged");
      expect(output.diffReport.view.getDiffView()).toBe("side-by-side");
      const staged = await lumine.repositories.executeGit(["diff", "--cached"], workingDirectory);
      expect(staged.stdout).toContain("+staged");
      expect(staged.stdout).not.toContain("+worktree");
    });
  }

  it("shows no file headers for unchanged snapshots in either layout", async () => {
    await lumine.packages.activatePackage("patch-view");
    await controller.diffCurrentFile();
    const output = lumine.workspace.getActivePaneItem();
    const report = output.diffReport;
    for (const section of ["staged", "unstaged"]) {
      await report.select(section);
      for (const mode of ["unified", "side-by-side"]) {
        await report.view.setDiffView(mode);
        expect(report.view.props.multiFilePatch.getFilePatches()).toEqual([]);
        expect(report.element.querySelector(".patch-view-FilePatchView-header")).toBeNull();
        expect(report.element.textContent).toContain("No changes to display");
      }
    }
    lumine.workspace.getActivePane().activateItem(editor);
    editor.setText("changed\n");
    await editor.save();
    await controller.diffCurrentFile();
    expect(report.view.getDiffView()).toBe("side-by-side");
    expect(report.view.props.multiFilePatch.anyPresent()).toBe(true);
    expect(report.element.querySelector(".patch-view-FilePatchView-header")).not.toBeNull();
    editor.setText("initial\n");
    await editor.save();
    lumine.workspace.getActivePane().activateItem(editor);
    await controller.diffCurrentFile();
    expect(report.view.getDiffView()).toBe("side-by-side");
    expect(report.view.props.multiFilePatch.getFilePatches()).toEqual([]);
    expect(report.element.querySelector(".patch-view-FilePatchView-header")).toBeNull();
    expect(report.element.textContent).toContain("No changes to display");
  });

  it("clears visual diffs when the provider disappears while retaining the text report", async () => {
    expect(lumine.packages.isPackageActive("git-panel")).toBe(false);
    await lumine.packages.activatePackage("patch-view");
    editor.setText("worktree\n");
    await editor.save();
    await controller.diffAll();
    const report = lumine.workspace.getActivePaneItem().diffReport;
    await report.view.setDiffView("side-by-side");
    const previousPatch = report.patches.get("unstaged");
    await lumine.packages.deactivatePackage("patch-view");
    expect(main.patchView).toBeNull();
    expect(report.view).toBeNull();
    expect(previousPatch.isDisposed()).toBe(true);
    expect(report.body.textContent).toContain("patch-view service is inactive");
    expect(report.body.textContent).toContain("+worktree");
    await lumine.packages.activatePackage("patch-view");
    expect(report.view.getDiffView()).toBe("side-by-side");
    expect(lumine.packages.isPackageActive("git-panel")).toBe(false);
  });

  it("does not let an obsolete provider edge clear its replacement", () => {
    const bridge = {};
    const first = main.consumePatchView(bridge);
    const second = main.consumePatchView(bridge);
    first.dispose();
    expect(main.patchView).toBe(bridge);
    expect(controller.patchView).toBe(bridge);
    second.dispose();
    expect(main.patchView).toBeNull();
    expect(controller.patchView).toBeNull();
  });

  it("opens existing changed files without opening ignored paths or directories", async () => {
    const ignoredPath = path.join(workingDirectory, "ignored.txt");
    fs.writeFileSync(ignoredPath, "ignored\n");
    fs.mkdirSync(path.join(workingDirectory, "nested-repository"));
    spyOn(repository, "ensureStatusSnapshot").and.resolveTo({
      files: [
        { path: "ignored.txt", ignored: true },
        { path: "missing.txt" },
        { path: "nested-repository" },
        { path: "example.txt" },
      ],
    });
    const open = spyOn(lumine.workspace, "open").and.resolveTo(editor);
    const notification = spyOn(lumine.notifications, "addSuccess");

    await controller.openChangedFiles();

    expect(open).toHaveBeenCalledOnceWith(
      path.join(repository.getWorkingDirectory(), "example.txt"),
      { activatePane: false },
    );
    expect(notification).toHaveBeenCalledWith("Opened 1 changed file");
  });

  it("previews and quick-commits the active file", async () => {
    editor.setText("quick change\n");
    await editor.save();

    await controller.quickCommitCurrentFile({ crumb: "Quick commit" });
    expect(controller.modals.preview.textContent).toContain("-initial");
    expect(controller.modals.preview.textContent).toContain("+quick change");

    await controller.modals.inputDialog.setQuery("Quick update");
    await lumine.commands.dispatch(controller.modals.inputDialog.getElement(), "core:confirm");

    const result = await lumine.repositories.executeGit(
      ["log", "-1", "--format=%s"],
      workingDirectory,
    );
    expect(result.stdout.trim()).toBe("Quick update");
  });

  it("uses Side by Side in the commit preview without changing the commit workflow", async () => {
    await lumine.packages.activatePackage("patch-view");
    editor.setText("quick change\n");
    await editor.save();
    await controller.quickCommitCurrentFile({ crumb: "Quick commit" });
    const report = controller.modals.diffReport;
    expect(report.selected).toBe("unstaged");
    expect(report.view.getDiffView()).toBe("unified");
    await report.view.setDiffView("side-by-side");
    expect(report.element.querySelectorAll("lumine-text-editor").length).toBe(2);
    const stagedBefore = await lumine.repositories.executeGit(
      ["diff", "--cached", "--name-only"],
      workingDirectory,
    );
    expect(stagedBefore.stdout).toBe("");

    await controller.modals.inputDialog.setQuery("Visual preview update");
    await lumine.commands.dispatch(controller.modals.inputDialog.getElement(), "core:confirm");
    const result = await lumine.repositories.executeGit(
      ["log", "-1", "--format=%s"],
      workingDirectory,
    );
    expect(result.stdout.trim()).toBe("Visual preview update");
    expect(controller.modals.diffReport).toBeNull();
    expect(report.destroyed).toBe(true);
  });

  it("creates stashes through the repository operation facade", async () => {
    editor.setText("stash me\n");
    await editor.save();

    controller.stash();
    await controller.modals.confirmInput("Saved work");

    const result = await lumine.repositories.executeGit(["stash", "list"], workingDirectory);
    expect(result.stdout).toContain("Saved work");
    expect(fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n")).toBe("initial\n");
  });

  it("blocks commits on configured protected branches", async () => {
    lumine.config.set("git.protectCommits", true);
    lumine.config.set("git.protectedBranches", ["main"]);
    await controller.commit();
    const previousHead = repository.getStatusSnapshot().head.oid;
    await controller.modals.confirmInput("Blocked commit");
    expect(controller.modals.inputDialogHost.isVisible()).toBe(true);
    expect(controller.modals.inputDialog.getElement().textContent).toContain(
      "protected branch main",
    );
    expect(repository.getStatusSnapshot().head.oid).toBe(previousHead);
  });

  it("keeps the commit dialog open when HEAD changes after its preview", async () => {
    editor.setText("staged for the preview\n");
    await editor.save();
    await repository.getOperations().stageFiles(["example.txt"]);
    await lumine.commands.dispatch(lumine.workspace.getElement(), "git-command:commit");
    expect(controller.modals.inputDialogHost.isVisible()).toBe(true);
    await repository.getOperations().commit("Concurrent commit");
    const current = await repository.refreshStatusSnapshot();
    await controller.modals.inputDialog.setQuery("Obsolete preview commit");
    await lumine.commands.dispatch(controller.modals.inputDialog.getElement(), "core:confirm");
    expect(controller.modals.inputDialogHost.isVisible()).toBe(true);
    expect(controller.modals.inputDialog.getElement().textContent).toContain("HEAD changed");
    expect(repository.getStatusSnapshot().head.oid).toBe(current.head.oid);
    const latest = await repository.getCommit("HEAD");
    expect(latest.subject).toBe("Concurrent commit");
  });

  it("removes its commands when deactivated", async () => {
    await lumine.packages.deactivatePackage("git-command");
    spyOn(controller, "perform");

    lumine.commands.dispatch(lumine.workspace.getElement(), "git-command:status");

    expect(controller.perform).not.toHaveBeenCalled();
  });
});
