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

For a split deployment, set `FRONTEND_URL` to the exact Vercel HTTPS origin (or a comma-separated list of production and preview origins) in Render. The frontend calls `https://food-with-heath-api.onrender.com`, and the Render service must allow those origins for credentialed browser sessions.

Deployment files are included: `vercel.json` configures the static Vercel frontend and `render.yaml` configures the Render Node service with a persistent disk for SQLite. In Render, set `FRONTEND_URL` to the final Vercel URL, then redeploy. In Vercel, import the repository and set the project root to `New-beginning-`.

Open `http://localhost:3001/` (or `http://localhost:3001/first.html`) in your browser. This Express URL serves the complete website and backend. Do not use VS Code Live Preview or open the HTML files with a `file://` URL; those modes cannot provide the authentication, sessions, password reset, or checkout APIs and may show `Forbidden. File does not reside within a trusted folder`.

## Deploy publicly

The repository includes a Vercel configuration for the frontend and a Render Blueprint for the backend:

1. In Render, create a Blueprint from this repository. It uses `render.yaml`, installs dependencies from `New-beginning-`, starts the Node service, and mounts persistent storage at `/opt/render/project/src/data`.
2. In the Render service environment, set `FRONTEND_URL` to the exact Vercel URL after the frontend is deployed. Keep the generated `SESSION_SECRET` and `DATA_DIR=/opt/render/project/src/data`.
3. In Vercel, import this repository and set the project root directory to `New-beginning-`. The frontend is already configured to call `https://food-with-heath-api.onrender.com`.
4. Redeploy Render after setting `FRONTEND_URL`, then check `https://food-with-heath-api.onrender.com/api/health` returns `{"status":"ok"}`.

The checkout uses Razorpay's hosted checkout. Add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` to `.env` locally or to the Render service environment. Use Razorpay test keys while testing; switch to live keys only after completing Razorpay account verification. A production email provider is also required for password-reset delivery. Guest demo login is for browsing only; checkout requires a registered account or password login.

The server provides hashed-password accounts, HTTP-only sessions, SQLite orders, rate-limited authentication and order endpoints, and security headers.

The browser stores only the username and email in `localStorage`. The password is never stored in browser storage or returned by the API; the server stores only its bcrypt hash. Leaving the password blank uses an explicitly labeled demo guest session and does not verify identity.

When the HTML is served by a static server without the Express API, username/email login runs locally as demo mode. Password login requires the Node.js server.

New users can select **Create account** with a username, email, and password of at least 8 characters. The backend saves the account and the browser stores only the returned username and email.

When users return, the server session restores their login when it is still valid. If they need to log in again, the saved username and email are prefilled; the password is always requested again and is never saved.

After a password login or account creation, the site offers to save the username and password through the browser's password manager. The website itself never stores the password in localStorage.

The **Forgot password** page accepts the account email and creates a single-use reset link that expires after 15 minutes. In development, the link is shown on the page because no email provider is configured. In production, configure an email provider before exposing reset links to users; the API intentionally returns the same message whether or not the email belongs to an account.

Razorpay creates the payment order server-side and verifies its HMAC signature server-side before the order is saved. The browser never sends raw card details to this server, and the Razorpay secret key is never exposed to the frontend.
