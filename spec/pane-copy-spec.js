const { OutputManager } = require("../lib/output-view");

const rawPatch = (value) =>
  `diff --git a/example.txt b/example.txt\nindex 1234567..abcdef0 100644\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-before\n+${value}\n`;

describe("Git command pane copy ownership", () => {
  let manager, bridge, source;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    const git = await lumine.packages.startPackage("git-panel");
    bridge = git.mainModule.provideDiff();
    manager = new OutputManager({ diffService: bridge });
    source = await manager.show("copy-fixture", {
      title: "Git Diff",
      diffData: {
        workingDirectory: __dirname,
        sections: [
          { id: "staged", title: "Staged", rawPatch: rawPatch("index") },
          { id: "unstaged", title: "Unstaged", rawPatch: rawPatch("worktree") },
        ],
      },
    });
    await globalThis.flushMicrotasks();
  });

  afterEach(async () => {
    manager.destroy();
    await globalThis.flushMicrotasks();
  });

  it("copies the selected snapshot, comparison layout and column without re-running a command", async () => {
    await source.diffReport.select("unstaged");
    await source.diffReport.view.setDiffView("side-by-side");
    await globalThis.flushMicrotasks();
    const pair = source.diffReport.view.refPatchController.get().refView.get().refSideBySide.get();
    pair.activeSide = "old";
    pair.focus();
    const copied = await lumine.workspace.copyPaneItem(source, {
      splitDirection: "right",
      activatePane: false,
    });
    await globalThis.flushMicrotasks();
    const copy = copied.item;
    expect(copy.diffData).not.toBe(source.diffData);
    expect(copy.diffReport.selected).toBe("unstaged");
    expect(copy.diffReport.view.getDiffView()).toBe("side-by-side");
    expect(copy.diffReport.view.capturePresentationState().activeSide).toBe("old");
    const sourceBuffer = source.diffReport.view.props.multiFilePatch.getBuffer();
    const copiedBuffer = copy.diffReport.view.props.multiFilePatch.getBuffer();
    expect(copiedBuffer).not.toBe(sourceBuffer);
    expect(copiedBuffer.getText()).toContain("worktree");
    await lumine.workspace.paneForItem(source).destroyItem(source, true);
    expect(copiedBuffer.isDestroyed()).toBe(false);
    await manager.setDiffService(null);
    expect(copy.diffReport.view).toBeNull();
    expect(copiedBuffer.isDestroyed()).toBe(true);
    expect(copy.diffReport.body.textContent).toContain("worktree");
    await manager.setDiffService(bridge);
    expect(copy.diffReport.view.getDiffView()).toBe("side-by-side");
  });

  it("owns and destroys copied outputs before insertion and rejects copies after provider retirement", () => {
    const copy = source.copy();
    expect(manager.allViews.has(copy)).toBe(true);
    expect(lumine.workspace.paneForItem(copy)).toBeFalsy();
    manager.destroy();
    expect(copy.isDestroyed()).toBe(true);
    expect(manager.allViews.size).toBe(0);
    expect(() => copy.copy()).toThrow();
  });

  it("opens a fresh command result without repurposing a surviving copied snapshot", async () => {
    const copy = source.copy();
    await lumine.workspace.open(copy);
    await lumine.workspace.paneForItem(source).destroyItem(source, true);
    const fresh = await manager.show("copy-fixture", {
      title: "Git Status",
      content: "new result",
    });
    expect(fresh).not.toBe(copy);
    expect(fresh.copyText).toBe("new result");
    expect(copy.copyText).toContain("worktree");
    expect(manager.allViews.size).toBe(2);
  });

  it("rejects cancellation before constructing any copied view", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => source.copy({ signal: controller.signal })).toThrow();
    expect(manager.allViews.size).toBe(1);
  });
});
