# New-beginning-
Trying to do something because I don't know how to use GitHub

## Deploy the frontend with Vercel

This repository includes a root `vercel.json`, so the frontend can be deployed directly from the repository root:

1. Import this GitHub repository at [vercel.com/new](https://vercel.com/new).
2. Leave **Root Directory** set to `./`. The root homepage redirects to `New-beginning-/first.html`.
3. Keep the default build settings and deploy.
4. Open the generated HTTPS URL.

The Vercel frontend is configured to call `https://food-with-heath-api.onrender.com`. The Render backend must be deployed separately from `render.yaml`, and its `FRONTEND_URL` environment variable must be set to the exact Vercel URL (without a trailing slash). Redeploy Render after setting that variable.

Vercel hosts the HTML, CSS, and browser JavaScript. Render hosts authentication, password resets, sessions, and orders. Real payments and production password-reset email delivery still require provider integrations.
