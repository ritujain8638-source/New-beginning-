(function () {
  "use strict";
  const isLocal = window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  window.FOOD_API_URL = isLocal ? "" : "https://food-with-heath-api.onrender.com";
})();
