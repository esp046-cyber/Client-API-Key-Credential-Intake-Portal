# Client API Key & Credential Intake Portal

A single-file, dependency-free Progressive Web App for securely collecting client API
credentials (Meta, Google Ads, GoHighLevel, and other integrations) and forwarding them
to an n8n workflow for validation and vault storage. Built for GitHub Pages, optimized
for mobile (iPhone 8 Plus and up).

**This tool never stores credentials.** The browser holds values in memory only for the
duration of the form fill and clears them immediately after a successful submission.
Nothing is written to `localStorage`, `sessionStorage`, or cookies.

---

## 1. How it works (client-side)

1. The client opens the portal link (optionally a personalized link like
   `?client=AcmeCorp` — see §4).
2. They pick a platform (Meta, Google Ads, GoHighLevel, or Other).
3. They fill in the fields for that platform. Secret fields are masked by default
   with a show/hide toggle.
4. On submit, the button shows an "Authenticating and Encrypting…" state and the
   app sends **one** `POST` request, as JSON, to your n8n webhook.
5. If n8n responds `2xx`, the client sees a success screen. Any `4xx`/`5xx` response
   or network failure shows an inline, friendly error and lets them retry.

---

## 2. Deploying the portal

1. Push this repository to GitHub.
2. In **Settings → Pages**, set the source to your default branch, root folder.
3. Open `index.html` and find:

   ```js
   const N8N_WEBHOOK_URL = 'YOUR_WEBHOOK_URL_HERE';
   ```

   Replace it with your **production** n8n webhook URL (must be `https://`).
   Until you do this, the app runs in `DEMO_MODE` and simulates submissions locally
   without sending anything anywhere — useful for reviewing the UI safely.

4. Also update the `connect-src` value inside the `<meta http-equiv="Content-Security-Policy">`
   tag near the top of `index.html` so it matches the **domain** of your webhook URL
   (see §5). The page will otherwise block its own fetch request.

5. Commit and push. Your portal is now live at
   `https://<your-username>.github.io/<repo-name>/`.

---

## 3. Setting up the n8n webhook receiver

This is the part your team owns. A minimal, production-safe workflow looks like this:

```
[Webhook: POST]
      |
      v
[If: honeypot check]  -->  (if website_url is non-empty) --> [NoOp / silently 200]
      | (empty - real submission)
      v
[Set: normalize/map fields]
      |
      v
[Store: write to vault / secrets manager / encrypted DB row]
      |
      v
[Respond to Webhook: 200 OK]
```

### Step-by-step

1. **Webhook node**
   - Method: `POST`
   - Path: something private and non-guessable, e.g. `/webhook/intake-8f2a1c`
   - Response Mode: "Using Respond to Webhook node" (so you control the status code
     the portal sees).
   - Copy the **Production URL** it gives you into `N8N_WEBHOOK_URL` in `index.html`.

2. **Honeypot check (If node)**
   - Condition: `{{$json["body"]["website_url"]}}` **is not empty**.
   - True branch: do nothing meaningful (log it as spam if you like), then respond
     `200 OK` anyway so bots don't learn to change tactics. Do **not** forward this
     branch to your storage step.
   - False branch: continue to the real workflow below.

3. **Map incoming fields (Set node)**

   The portal always sends this shape:

   ```json
   {
     "clientEmail": "name@company.com",
     "clientTag": "AcmeCorp",
     "platform": "meta",
     "platformLabel": "Meta / Facebook Ads",
     "credentials": {
       "accessToken": "EAAG...",
       "businessManagerId": "123456789012345"
     },
     "submittedAt": "2026-09-14T10:32:00.000Z",
     "source": "secure-vault-pwa",
     "website_url": ""
   }
   ```

   | Field | Notes |
   |---|---|
   | `clientEmail` | The submitter's work email. Use for the confirmation notification. |
   | `clientTag` | Only present if the link included `?client=`. Use to file the credential under the right agency account automatically. |
   | `platform` | Machine key: `meta`, `google`, `ghl`, or `other`. Use this to branch your workflow (Switch node) into per-platform validation logic. |
   | `platformLabel` | Human-readable platform name, for notifications/logging. |
   | `credentials` | An object whose keys depend on `platform` — see table below. |
   | `submittedAt` | ISO-8601 timestamp, generated client-side. Treat as informational; also stamp your own server-side received-at time. |
   | `source` | Always `"secure-vault-pwa"` — useful if you ever point more than one intake form at the same webhook. |
   | `website_url` | Honeypot. Should always be empty for real users — see step 2. |

   **`credentials` keys by platform:**

   | Platform | Keys |
   |---|---|
   | `meta` | `accessToken`, `businessManagerId` |
   | `google` | `customerId`, `developerToken`, `refreshToken` |
   | `ghl` | `apiKey`, `locationId` |
   | `other` | `credentialName`, `credentialValue` |

   Use a `Switch` node on `{{$json["body"]["platform"]}}` if you want separate
   validation/storage branches per platform (e.g. calling Meta's Graph API to test
   the token before accepting it).

4. **Store the credential — do not just log it**
   - Write directly to a secrets manager (HashiCorp Vault, AWS Secrets Manager, GCP
     Secret Manager) via its API, **or**
   - Write to a database column that is encrypted at rest, **or**
   - At absolute minimum, turn off n8n's execution data logging for this workflow
     (Workflow Settings → Save Execution Progress / Save Manual Executions → Off,
     or strip `credentials` with a `Set` node before it hits any node that persists
     execution data).
   - Never forward the raw payload to a generic logging/analytics tool.

5. **Respond to Webhook node**
   - Return `200` with a small JSON body (e.g. `{ "message": "ok" }`) on success.
   - Return `4xx` with `{ "message": "<reason>" }` if you validated the token
     against the platform's API and it failed — the portal will surface that
     message to the client verbatim, so keep it client-appropriate.
   - Return `5xx` for anything unexpected on your end.

---

## 4. Sending clients a pre-tagged link

Append `?client=` to the portal URL:

```
https://<your-username>.github.io/<repo-name>/?client=AcmeCorp
```

The portal reads this on load, shows a small "Submitting as: AcmeCorp" banner so the
client can confirm it's correct, and includes it as `clientTag` in the payload — no
manual matching required on your end.

---

## 5. Security notes

- **The webhook URL is public.** Because this repo and the deployed page are public,
  anyone can view the webhook URL in source. Treat it like a public form action, not
  a secret — the honeypot field and your own n8n-side rate limiting are what actually
  protect it (see §3, step 2, and consider adding n8n's rate-limit node or a
  Cloudflare/WAF rule in front of the webhook).
- **Never hardcode real secrets in `index.html`.** The only credential-shaped value in
  that file should be the intake webhook URL itself.
- **Keep the Content-Security-Policy's `connect-src` in sync** with your webhook's
  domain — see §2, step 4.
- See `security.txt` for how outside researchers should report a vulnerability in
  this portal.
- `robots.txt` blocks all crawlers so this intake tool doesn't get indexed by
  search engines. It is not a substitute for the honeypot/rate-limiting above.

---

## 6. Customizing

- **Add a platform:** edit the `PLATFORMS` object in `index.html` — add a new key
  with a `label`, `icon`, and `fields` array (each field needs `id`, `label`,
  `placeholder`, `secure`, `required`, and a `pattern`/`error` for validation).
- **Change validation rules:** each field's `pattern` is a plain JS regex tested
  against the trimmed value before submit.
- **Rebrand:** colors and fonts are defined in the `tailwind.config` script block
  and the `<style>` block at the top of `index.html`.
