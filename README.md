# healthpulse-dashboard

Static frontend for the HealthPulse training-trends dashboard.

This repo only holds `index.html` + `client.js`. Live data is fetched at
runtime from the Supabase Edge Function `dashboard`, gated by a token
that is supplied via `?t=<TOKEN>` in the URL — the token never lives in
this repo.

**Source code for the data pipeline is in the private healthpulse repo.**
