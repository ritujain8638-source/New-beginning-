# Food with Heath

## Run locally

```bash
npm install
cp .env.example .env
```

Set `SESSION_SECRET` in `.env` to a random value of at least 32 characters, then start the server:

```bash
npm start
```

Open `http://localhost:3000/` (or `http://localhost:3000/first.html`) in your browser. Do not open the HTML files with a `file://` URL; browsers block backend requests and may show `Forbidden. File does not reside within a trusted folder`.

The server provides hashed-password accounts, HTTP-only sessions, SQLite orders, rate-limited authentication and order endpoints, and security headers.

The browser stores only the username and email in `localStorage`. The password is never stored in browser storage or returned by the API; the server stores only its bcrypt hash. Leaving the password blank uses an explicitly labeled demo guest session and does not verify identity.

When the HTML is served by a static server without the Express API, username/email login runs locally as demo mode. Password login requires the Node.js server.

New users can select **Create account** with a username, email, and password of at least 8 characters. The backend saves the account and the browser stores only the returned username and email.

When users return, the server session restores their login when it is still valid. If they need to log in again, the saved username and email are prefilled; the password is always requested again and is never saved.

The checkout is still a demo payment flow. For real payments, replace the demo token with a token from a provider such as Stripe or Razorpay; never send raw card details to this server or store them.
