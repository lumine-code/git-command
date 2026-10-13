module.exports = class ControllerLoader {
  importController() {
    return import("./controller.js");
  }

  load() {
    this.pending ??= Promise.resolve()
      .then(() => this.importController())
      .then((namespace) => namespace.default ?? namespace)
      .catch((error) => {
        this.pending = null;
        throw error;
      });
    return this.pending;
  }
};
