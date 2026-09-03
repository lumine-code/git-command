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

  beforeEach(async () => {
    lumine.config.set("git-command.protectCommits", false);
    lumine.config.set("git-command.protectPushes", false);
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
    await lumine.packages.deactivatePackage("command-palette");
    await lumine.packages.deactivatePackage("git-command");
    for (const pane of lumine.workspace.getPanes()) {
      for (const item of pane.getItems()) {
        await pane.destroyItem(item, { force: true });
      }
    }
    lumine.repositories.forget(repository);
    lumine.config.unset("git-command.protectCommits");
    lumine.config.unset("git-command.protectPushes");
    try {
      fs.rmSync(workingDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Windows can retain a short-lived worker handle after a Git operation.
    }
  });

  it("registers its commands and opens the select list in a modal panel", () => {
    lumine.commands.dispatch(lumine.workspace.getElement(), "git-command:show-command-list");

    expect(main.commandList.selectList.isVisible()).toBe(true);
    expect(main.commandList.selectList.getPanel().isVisible()).toBe(true);
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

    expect(controller.perform).toHaveBeenCalledWith("stage-all");
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

    const list = commandPalette.mainModule.list.selectListView;
    expect(list.isVisible()).toBe(true);
    expect(list.getItems().some(({ name }) => name === "git-command:show-command-list")).toBe(true);
  });

  it("uses close and push primary actions for the two command kinds", async () => {
    const perform = spyOn(controller, "perform").and.returnValue(Promise.resolve());
    const list = main.commandList.selectList;

    list.show();
    await list.selectItemById("stage-all");
    const closed = await list.confirmSelection();
    expect(closed.action.disposition).toBe("close");
    expect(perform).toHaveBeenCalledWith("stage-all", { crumb: "Stage all" });
    expect(list.isVisible()).toBe(false);

    list.show();
    await list.selectItemById("commit");
    const pushed = await list.confirmSelection();
    expect(pushed.action.disposition).toBe("push");
    expect(perform).toHaveBeenCalledWith("commit", { crumb: "Commit" });
    expect(list.isVisible()).toBe(true);
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
    expect(list.isVisible()).toBe(false);
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
    lumine.config.set("git-command.protectCommits", true);
    lumine.config.set("git-command.protectedBranches", ["main"]);
    spyOn(lumine.notifications, "addWarning");

    await controller.commit();

    expect(lumine.notifications.addWarning).toHaveBeenCalled();
    expect(controller.modals.inputDialog.isVisible()).toBe(false);
  });

  it("removes its commands when deactivated", async () => {
    await lumine.packages.deactivatePackage("git-command");
    spyOn(controller, "perform");

    lumine.commands.dispatch(lumine.workspace.getElement(), "git-command:status");

    expect(controller.perform).not.toHaveBeenCalled();
  });
});
