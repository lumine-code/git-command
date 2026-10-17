const ModalManager = require("../lib/modal-manager");

describe("Git selection keep-open mode", () => {
  let modals;

  beforeEach(() => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    modals = new ModalManager();
  });

  afterEach(async () => {
    await modals.destroy();
  });

  for (const secondary of [false, true]) {
    it(`preserves the ${secondary ? "nested" : "primary"} operation for repeated confirmations`, async () => {
      const items = [
        { id: "first", label: "First" },
        { id: "second", label: "Second" },
      ];
      const onConfirm = jasmine.createSpy("onConfirm").and.resolveTo(true);
      await modals[secondary ? "showSecondarySelection" : "showSelection"]({
        items,
        onConfirm,
      });
      const list = secondary ? modals.secondarySelectList : modals.selectList;
      const host = secondary ? modals.secondarySelectListHost : modals.selectListHost;
      await list.runAction("select-list:toggle-keep-open");

      for (const item of items) {
        await list.selectItem(item);
        await list.confirmSelection();
        expect(onConfirm.calls.mostRecent().args[0]).toBe(item);
        expect(onConfirm.calls.mostRecent().args[1]()).toBe(true);
        expect(host.isVisible()).toBe(true);
      }
      expect(onConfirm).toHaveBeenCalledTimes(2);

      await list.runAction("select-list:toggle-keep-open");
      await list.confirmSelection();
      expect(host.isVisible()).toBe(false);
      expect(modals[secondary ? "pendingSecondarySelection" : "pendingSelection"]).toBeNull();
    });
  }

  it("uses the mode captured before an asynchronous operation finishes", async () => {
    let finish;
    const onConfirm = () => new Promise((resolve) => (finish = resolve));
    await modals.showSelection({ items: [{ id: "pending", label: "Pending" }], onConfirm });
    await modals.selectList.runAction("select-list:toggle-keep-open");
    const running = modals.selectList.confirmSelection();
    for (let tick = 0; tick < 20 && !finish; tick++) await Promise.resolve();
    expect(finish).toEqual(jasmine.any(Function));
    await modals.selectList.setKeepOpen(false);
    finish(true);
    await running;

    expect(modals.selectListHost.isVisible()).toBe(true);
  });
});
