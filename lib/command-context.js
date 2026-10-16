module.exports = function commandContext(event, scope) {
  const editor = scope === "file" ? event?.context?.fileEditor : null;
  if (!editor || editor === event.context.documentItem)
    return lumine.repositories.getCommandContext(event, { scope });
  const path = editor.getPath?.() ?? null;
  return Object.freeze({
    editor,
    path,
    repository: path ? lumine.repositories.getForPath(path) : null,
  });
};
