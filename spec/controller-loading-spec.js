function deferred() {
  let resolve;
  const promise = new Promise((accept) => (resolve = accept));
  return { promise, resolve };
}

describe("Git Command native controller", () => {
  let main;
  beforeEach(async () => {
    main = (await lumine.packages.activatePackage("git-command")).mainModule;
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("git-command");
  });

  function testWindow() {
    let close;
    return {
      onWillDestroy(callback) {
        close = callback;
        return { dispose() {} };
      },
      close() {
        close();
      },
    };
  }

  it("shares native imports and keeps the legacy synchronous controller identity", async () => {
    const Loader = require("../lib/controller-loader");
    const loader = new Loader();
    const imported = spyOn(loader, "importController").and.callThrough();
    const first = loader.load();
    expect(loader.load()).toBe(first);
    expect(await first).toBe(require("../lib/controller"));
    expect(imported).toHaveBeenCalledTimes(1);
    const controller = await main.withController(null, (value) => value);
    expect(main.ensureController()).toBe(controller);
    expect(controller.constructor).toBe(await first);
  });

  it("retries a failed import without caching the rejected promise", async () => {
    const Loader = require("../lib/controller-loader");
    const loader = new Loader();
    const nativeImport = loader.importController.bind(loader);
    const failure = new Error("temporary controller failure");
    const imported = spyOn(loader, "importController").and.rejectWith(failure);
    await expectAsync(loader.load()).toBeRejectedWith(failure);
    imported.and.callFake(nativeImport);
    expect(await loader.load()).toBe(require("../lib/controller"));
  });

  it("captures file and repository context before import rather than following a later active editor", async () => {
    const Controller = require("../lib/controller");
    const perform = spyOn(Controller.prototype, "perform").and.resolveTo();
    const editor = { getPath: () => "captured.txt", isDestroyed: () => false };
    const context = { editor, path: "captured.txt", repository: { isDestroyed: () => false } };
    const capture = spyOn(lumine.repositories, "getCommandContext").and.returnValue(context);
    const importing = deferred();
    spyOn(main, "loadController").and.returnValue(importing.promise);
    const pending = main.performAction("stage-current-file");
    expect(capture).toHaveBeenCalledTimes(1);
    capture.and.returnValue({ editor: null, path: "other.txt", repository: null });
    importing.resolve(Controller);
    await pending;
    expect(perform.calls.mostRecent().args[1].context).toBe(context);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("shares controller creation and uses the current borrowed diff service after import", async () => {
    const Controller = require("../lib/controller");
    const perform = spyOn(Controller.prototype, "perform").and.callFake(function () {
      return Promise.resolve(this);
    });
    const importing = deferred();
    spyOn(main, "loadController").and.returnValue(importing.promise);
    const first = main.performAction("status");
    const second = main.performAction("log");
    const diffService = { diffEditors() {} };
    const edge = main.consumeDiff(diffService);
    importing.resolve(Controller);
    const controllers = await Promise.all([first, second]);
    expect(controllers[0]).toBe(controllers[1]);
    expect(main.controller.diffService).toBe(diffService);
    expect(perform).toHaveBeenCalledTimes(2);
    edge.dispose();
  });

  for (const retire of ["window", "package", "editor"]) {
    it(`does not run a Git action after its ${retire} retires during import`, async () => {
      const Controller = require("../lib/controller");
      const perform = spyOn(Controller.prototype, "perform").and.resolveTo();
      const importing = deferred();
      const window = testWindow();
      let destroyed = false;
      const editor = { getPath: () => "captured.txt", isDestroyed: () => destroyed };
      spyOn(lumine.repositories, "getCommandContext").and.returnValue({
        editor,
        path: "captured.txt",
        repository: null,
      });
      spyOn(main, "loadController").and.returnValue(importing.promise);
      const pending = main.performAction("stage-current-file", { context: { window } });
      if (retire === "window") window.close();
      else if (retire === "package") await lumine.packages.deactivatePackage("git-command");
      else destroyed = true;
      importing.resolve(Controller);
      await pending;
      expect(perform).not.toHaveBeenCalled();
    });
  }

  it("keeps a retired import out of a reloaded package generation", async () => {
    const oldMain = main;
    const Controller = require("../lib/controller");
    const importing = deferred();
    spyOn(main, "loadController").and.returnValue(importing.promise);
    const pending = main.performAction("status");
    await lumine.packages.unloadPackage("git-command");
    main = (await lumine.packages.activatePackage("git-command")).mainModule;
    const controller = await main.withController(null, (value) => value);
    importing.resolve(Controller);
    await pending;
    expect(oldMain.controller).toBe(null);
    expect(controller.constructor).toBe(require("../lib/controller"));
    expect(controller.constructor).not.toBe(Controller);
  });
});
