(function () {
  "use strict";

  const storageKey = "foodWithHeathUser";

  window.userDataStore = {
    saveUser: function (user) {
      const safeUser = {
        username: user.username,
        email: user.email
      };

      localStorage.setItem(storageKey, JSON.stringify(safeUser));
      return safeUser;
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
