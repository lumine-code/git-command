const { OutputManager } = require("../lib/output-view");
describe("Git command output resource ownership", () => {
  let manager, source;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    manager = new OutputManager();
    source = await manager.show("status-fixture", { title: "Git Status", content: "first result" });
  });
  afterEach(async () => {
    manager.destroy();
    await globalThis.flushMicrotasks();
  });

  it("silently skips copy without allocating a view, changing focus or mutating panes", async () => {
    const panes = lumine.workspace.getPanes();
    const active = lumine.workspace.getActivePane();
    const warnings = spyOn(lumine.notifications, "addWarning");
    const errors = spyOn(lumine.notifications, "addError");
    expect(await lumine.workspace.copyPaneItem(source, { splitDirection: "right" })).toBeNull();
    expect(manager.allViews.size).toBe(1);
    expect(lumine.workspace.getPanes()).toEqual(panes);
    expect(lumine.workspace.getActivePane()).toBe(active);
    expect(warnings).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it("keeps independent executions of the same command in separate result cards", async () => {
    const next = await manager.show("status-fixture", {
      title: "Git Status",
      content: "next result",
    });
    expect(next).not.toBe(source);
    expect(next.getSingletonKey()).not.toBe(source.getSingletonKey());
    expect(source.copyText).toBe("first result");
    expect(next.copyText).toBe("next result");
    expect(manager.allViews.size).toBe(2);
  });

  it("moves an output unchanged and reopens it without duplicating its resource", async () => {
    const root = source.element;
    const moved = await lumine.workspace.movePaneItem(source, { splitDirection: "right" });
    expect(moved.item).toBe(source);
    expect(source.element).toBe(root);
    const panes = lumine.workspace.getPanes();
    expect(await lumine.workspace.open(source.getURI(), { split: "down" })).toBe(source);
    expect(lumine.workspace.getPanes()).toEqual(panes);
  });

  it("retires every distinct execution and removes its pane ownership", async () => {
    const next = await manager.show("status-fixture", {
      title: "Git Status",
      content: "next result",
    });
    manager.destroy();
    expect(source.isDestroyed()).toBe(true);
    expect(next.isDestroyed()).toBe(true);
    expect(lumine.workspace.paneForItem(source)).toBeFalsy();
    expect(lumine.workspace.paneForItem(next)).toBeFalsy();
    expect(manager.allViews.size).toBe(0);
  });
});
