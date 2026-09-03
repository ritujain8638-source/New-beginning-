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

Open `http://localhost:3000/first.html`. The server provides hashed-password accounts, HTTP-only sessions, SQLite orders, rate-limited authentication and order endpoints, and security headers.

The checkout is still a demo payment flow. For real payments, replace the demo token with a token from a provider such as Stripe or Razorpay; never send raw card details to this server or store them.
