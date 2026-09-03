(function () {
  "use strict";

  const storageKey = "foodWithHeathUser";

  function safeUser(user) {
    return {
      username: user.username,
      email: user.email
    };
  }

  async function readResponse(response) {
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || `Request failed (${response.status}).` };
    }
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  window.userDataStore = {
    setUser: function (user) {
      localStorage.setItem(storageKey, JSON.stringify(safeUser(user)));
      return user;
    },

    saveUser: async function (user) {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(user)
      });
      const safeUser = await readResponse(response);
      return this.setUser(safeUser);
    },

    saveDemoUser: async function (user) {
      const response = await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(user)
      });
      if (response.status === 404) return this.setUser(user);
      return this.setUser(await readResponse(response));
    },

    getUser: function () {
      const storedUser = localStorage.getItem(storageKey);
      if (!storedUser) return null;
      const user = JSON.parse(storedUser);
      return this.setUser(user);
    },

    restoreSession: async function () {
      const response = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (response.status === 404) return this.getUser();
      if (!response.ok) {
        this.clearUser();
        return null;
      }
      return this.setUser(await readResponse(response));
    },

    clearUser: function () {
      localStorage.removeItem(storageKey);
    }
  };
})();
