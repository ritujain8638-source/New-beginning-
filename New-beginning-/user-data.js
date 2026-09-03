(function () {
  "use strict";

  const storageKey = "foodWithHeathUser";

  window.userDataStore = {
    setUser: function (user) {
      localStorage.setItem(storageKey, JSON.stringify({
        username: user.username,
        email: user.email
      }));
      return user;
    },

    saveUser: async function (user) {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(user)
      });
      if (!response.ok) throw new Error((await response.json()).error || "Unable to log in.");
      const safeUser = await response.json();
      return this.setUser(safeUser);
    },

    getUser: function () {
      const storedUser = localStorage.getItem(storageKey);
      return storedUser ? JSON.parse(storedUser) : null;
    },

    clearUser: function () {
      localStorage.removeItem(storageKey);
    }
  };
})();
