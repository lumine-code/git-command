const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
/* global conditionPromise */

describe("Git command modal completion ownership", () => {
  let directory, temporaryRoot, repository, operations, controller;

  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  };

  beforeEach(async () => {
    jasmine.useRealClock();
    temporaryRoot = fs.realpathSync.native(os.tmpdir());
    directory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(temporaryRoot, "git-modal-owned-")),
    );
    repository = await lumine.repositories.initialize(directory, { initialBranch: "main" });
    operations = repository.getOperations();
    await operations.setConfig("user.name", "Git Modal Specs");
    await operations.setConfig("user.email", "modal@lumine.invalid");
    fs.writeFileSync(path.join(directory, "initial.txt"), "initial\n");
    await operations.stageFiles(["initial.txt"]);
    await operations.commit("Initial commit");
    await lumine.workspace.open(path.join(directory, "initial.txt"));
    lumine.repositories.setActiveRepository(repository, { pin: true });
    jasmine.attachToDOM(lumine.workspace.getElement());
    const main = (await lumine.packages.activatePackage("git-command")).mainModule;
    controller = main.ensureController();
  });

  afterEach(async () => {
    lumine.repositories.setActiveRepository(null);
    await lumine.packages.deactivatePackage("git-command");
    for (const editor of lumine.workspace.getTextEditors()) editor.destroy();
    await lumine.repositories.forget(repository);
    const relative = path.relative(temporaryRoot, directory);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`))
      throw new Error("Temporary repository escaped its root");
    try {
      await fs.promises.rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch (error) {
      if (!["EPERM", "EBUSY", "ENOTEMPTY"].includes(error.code)) throw error;
      // A worker can briefly retain a Windows handle after repository retirement.
    }
  });

  async function dispatch(action) {
    return lumine.commands.dispatch(lumine.workspace.getElement(), `git-command:${action}`);
  }

  it("preserves a newer input prompt when an already-confirmed real Git operation completes", async () => {
    const gate = deferred();
    const checkout = operations.checkout.bind(operations);
    const started = spyOn(operations, "checkout").and.callFake(async (...args) => {
      await gate.promise;
      return checkout(...args);
    });
    await dispatch("new-branch");
    controller.modals.inputDialog.setQuery("first-owned");
    const pending = lumine.commands.dispatch(
      controller.modals.inputDialog.getElement(),
      "git-command:confirm-input",
    );
    await conditionPromise(() => started.calls.count() === 1);
    await dispatch("new-branch");
    controller.modals.inputDialog.setQuery("new prompt text");
    const success = spyOn(lumine.notifications, "addSuccess");
    gate.resolve();
    await pending;

    expect((await repository.ensureRefsSnapshot()).head.name).toBe("first-owned");
    expect(controller.modals.inputDialogHost.isVisible()).toBe(true);
    expect(controller.modals.inputDialog.getQuery()).toBe("new prompt text");
    expect(success).not.toHaveBeenCalled();
  });

  it("does not publish an old confirmation failure into a newer input and loading state", async () => {
    const gate = deferred();
    const checkout = spyOn(operations, "checkout").and.returnValue(gate.promise);
    await dispatch("new-branch");
    const pending = controller.modals.confirmInput("old failed branch");
    await conditionPromise(() => checkout.calls.count() === 1);
    await dispatch("new-branch");
    controller.modals.inputDialog.setQuery("new text survives");
    await controller.modals.inputDialog.setLoadingState({ message: "new loading" });
    gate.reject(new Error("old checkout failed"));
    await pending;

    expect(controller.modals.inputDialogHost.isVisible()).toBe(true);
    expect(controller.modals.inputDialog.getQuery()).toBe("new text survives");
    expect(controller.modals.inputDialog.getStatus()).toBeNull();
    expect(controller.modals.inputDialog.getLoadingState().message).toBe("new loading");
  });

  it("keeps a newer branch list when an older confirmed checkout completes", async () => {
    await operations.checkout("other", { createNew: true });
    await operations.checkout("main");
    const gate = deferred();
    const checkout = operations.checkout.bind(operations);
    const started = spyOn(operations, "checkout").and.callFake(async (...args) => {
      await gate.promise;
      return checkout(...args);
    });
    await dispatch("checkout");
    const selected = controller.modals.selectList
      .getItems()
      .find((item) => item.branch === "other");
    const pending = controller.modals.confirmSelection(selected);
    await conditionPromise(() => started.calls.count() === 1);
    await dispatch("checkout");
    controller.modals.selectList.setQuery("new list query");
    const success = spyOn(lumine.notifications, "addSuccess");
    gate.resolve();
    await pending;

    expect((await repository.ensureRefsSnapshot()).head.name).toBe("other");
    expect(controller.modals.selectListHost.isVisible()).toBe(true);
    expect(controller.modals.selectList.getQuery()).toBe("new list query");
    expect(success).not.toHaveBeenCalled();
  });

  it("preserves a current checkout error and keeps the prompt open", async () => {
    const error = new Error("current checkout failed");
    spyOn(operations, "checkout").and.rejectWith(error);
    await dispatch("new-branch");
    await controller.modals.confirmInput("new branch");

    expect(controller.modals.inputDialogHost.isVisible()).toBe(true);
    expect(controller.modals.inputDialog.getStatus().message).toBe("current checkout failed");
  });

  it("does not publish an old commit failure through the dialog handed to its controller callback", async () => {
    const gate = deferred();
    const workflow = spyOn(operations, "runWorkflow").and.returnValue(gate.promise);
    await dispatch("commit");
    const pending = controller.modals.confirmInput("old commit");
    await conditionPromise(() => workflow.calls.count() === 1);
    await dispatch("new-branch");
    controller.modals.inputDialog.setQuery("new branch prompt");
    await controller.modals.inputDialog.setLoadingState({ message: "new loading" });
    gate.reject(new Error("old commit failed"));
    await pending;

    expect(controller.modals.inputDialogHost.isVisible()).toBe(true);
    expect(controller.modals.inputDialog.getQuery()).toBe("new branch prompt");
    expect(controller.modals.inputDialog.getStatus()).toBeNull();
    expect(controller.modals.inputDialog.getLoadingState().message).toBe("new loading");
  });

  it("does not open output for an obsolete confirmed custom command", async () => {
    const gate = deferred();
    const execute = operations.executeGit.bind(operations);
    const started = spyOn(operations, "executeGit").and.callFake(async (...args) => {
      await gate.promise;
      return execute(...args);
    });
    await dispatch("run");
    const pending = controller.modals.confirmInput("status --short");
    await conditionPromise(() => started.calls.count() === 1);
    await dispatch("new-branch");
    controller.modals.inputDialog.setQuery("preserved new prompt");
    const output = spyOn(controller, "showOutput").and.callThrough();
    gate.resolve();
    await pending;

    expect(output).not.toHaveBeenCalled();
    expect(controller.modals.inputDialogHost.isVisible()).toBe(true);
    expect(controller.modals.inputDialog.getQuery()).toBe("preserved new prompt");
  });

  it("keeps a replacement package generation after an already-confirmed checkout completes", async () => {
    const gate = deferred();
    const checkout = operations.checkout.bind(operations);
    const started = spyOn(operations, "checkout").and.callFake(async (...args) => {
      await gate.promise;
      return checkout(...args);
    });
    await dispatch("new-branch");
    const pending = controller.modals.confirmInput("retired-owner");
    await conditionPromise(() => started.calls.count() === 1);
    await lumine.packages.deactivatePackage("git-command");
    const main = (await lumine.packages.activatePackage("git-command")).mainModule;
    const replacement = main.ensureController();
    await dispatch("new-branch");
    replacement.modals.inputDialog.setQuery("replacement text");
    const success = spyOn(lumine.notifications, "addSuccess");
    gate.resolve();
    await pending;

    expect((await repository.ensureRefsSnapshot()).head.name).toBe("retired-owner");
    expect(replacement.modals.inputDialogHost.isVisible()).toBe(true);
    expect(replacement.modals.inputDialog.getQuery()).toBe("replacement text");
    expect(success).not.toHaveBeenCalled();
  });

  it("can return to the stash list from a nested action and confirm that stash normally", async () => {
    fs.writeFileSync(path.join(directory, "initial.txt"), "stash me\n");
    await operations.stashPush({ message: "nested stash" });
    await dispatch("manage-stashes");
    const stash = controller.modals.selectList.getItems()[0];
    await controller.modals.confirmSelection(stash);
    expect(controller.modals.secondarySelectListHost.isVisible()).toBe(true);
    await lumine.commands.dispatch(lumine.workspace.getElement(), "modal:go-back");
    expect(controller.modals.selectListHost.isVisible()).toBe(true);
    await controller.modals.confirmSelection(stash);
    const action = controller.modals.secondarySelectList
      .getItems()
      .find((item) => item.action === "stashDrop");
    const success = spyOn(lumine.notifications, "addSuccess");
    await controller.modals.confirmSecondarySelection(action);

    expect((await operations.executeGit(["stash", "list"], { readOnly: true })).stdout).toBe("");
    expect(controller.modals.secondarySelectListHost.isVisible()).toBe(false);
    expect(success).toHaveBeenCalledWith(`Dropped ${stash.reference}`);
  });

  it("keeps a newer nested stash step after an older confirmed drop finishes", async () => {
    fs.writeFileSync(path.join(directory, "initial.txt"), "stash me\n");
    await operations.stashPush({ message: "nested stash" });
    const gate = deferred();
    const drop = operations.stashDrop.bind(operations);
    const started = spyOn(operations, "stashDrop").and.callFake(async (...args) => {
      await gate.promise;
      return drop(...args);
    });
    await dispatch("manage-stashes");
    const stash = controller.modals.selectList.getItems()[0];
    await controller.modals.confirmSelection(stash);
    const action = controller.modals.secondarySelectList
      .getItems()
      .find((item) => item.action === "stashDrop");
    const pending = controller.modals.confirmSecondarySelection(action);
    await conditionPromise(() => started.calls.count() === 1);
    await dispatch("manage-stashes");
    await controller.modals.confirmSelection(controller.modals.selectList.getItems()[0]);
    controller.modals.secondarySelectList.setQuery("new nested query");
    const success = spyOn(lumine.notifications, "addSuccess");
    gate.resolve();
    await pending;

    expect((await operations.executeGit(["stash", "list"], { readOnly: true })).stdout).toBe("");
    expect(controller.modals.secondarySelectListHost.isVisible()).toBe(true);
    expect(controller.modals.secondarySelectList.getQuery()).toBe("new nested query");
    expect(success).not.toHaveBeenCalled();
  });
});
