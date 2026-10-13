describe("Git command dialogs in editor windows", () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("git-command");
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("git-command");
    await lumine.workspace.discardEditorWindows();
  });
  it("keeps action pickers and modal flows in independent native documents", async () => {
    const workspace = lumine.workspace;
    const first = await workspace.open();
    const extra = await workspace.openEditorWindow({ show: false });
    const second = workspace.buildTextEditor();
    extra.getEditorContainer().getActivePane().activateItem(second, { activatePane: true });
    await lumine.commands.dispatch(first.getElement(), "git-command:show-command-list");
    await lumine.commands.dispatch(second.getElement(), "git-command:show-command-list");
    const main = lumine.packages.getActivePackage("git-command").mainModule;
    const local = main.commandLists.get(workspace.getMainWindow()).list;
    const remote = main.commandLists.get(extra).list;
    expect(local.selectListHost.isVisible()).toBe(true);
    expect(remote.selectList.getElement().ownerDocument).toBe(extra.getDocument());
    await local.selectList.setQuery("local");
    await remote.selectList.setQuery("remote");
    expect(local.selectList.getQuery()).toBe("local");
    const scope = main.ensureController().forWindow(extra);
    scope.modals.inputDialogHost.getPanel();
    expect(scope.modals.inputDialog.getElement().ownerDocument).toBe(extra.getDocument());
    const output = await scope.outputs.show("native", {
      title: "Native Git output",
      text: "captured",
    });
    expect(workspace.paneForItem(output).getContainer()).toBe(extra.getEditorContainer());
    await workspace.attachWindow(extra);
    expect(scope.destroyed).toBe(true);
    expect(main.commandLists.has(extra)).toBe(false);
  });
});
