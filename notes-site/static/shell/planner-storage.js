const plannerStorage = (() => {
  const userId = document.body.dataset.userId;
  const key = userId ? `steady-planner-rebuild-v1:${userId}` : null;

  return {
    key,
    read() {
      if (!key) return null;
      try {
        return JSON.parse(localStorage.getItem(key));
      } catch {
        return null;
      }
    },
    save(state) {
      if (!key) return;
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        // Keep the planner usable in memory if browser storage is unavailable.
      }
    },
  };
})();
