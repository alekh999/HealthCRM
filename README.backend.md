# Jabalpur Clinic Portal — backend setup

This repository now contains a Node.js + PostgreSQL API for the existing GitHub Pages frontend.

## What's connected

- Real database-backed staff accounts and login.
- Password hashing with bcrypt, signed eight-hour API sessions and role checks.
- Password changes verified against the current password.
- Admin-only staff account creation.
- Patient records stored in PostgreSQL. Address, medical history and insurance policy ID are encrypted by the application before being stored.
- Invoice records stored in PostgreSQL with INR as the only supported currency.
- AI-backed FAQ assistant and report summary endpoints using the OpenAI Responses API. The API key remains on the server.
- Audit events for account, patient and invoice changes.

## Deploy on Render

1. Open the Render dashboard and choose **New → Blueprint**.
2. Connect the `alekh999/HealthCRM` GitHub repository and select the `main` branch.
3. Render reads `render.yaml` and proposes a Node web service and PostgreSQL database.
4. During creation, enter a unique `BOOTSTRAP_ADMIN_PASSWORD` of at least 12 characters and your private `OPENAI_API_KEY`. Do not put either value in GitHub.
5. Create the resources and wait for the service health check at `/api/health` to return `{"status":"ok",...}`.
6. Open the URL for the `healthcrm-api` web service. The same service also serves the frontend at its root URL.
7. If Render assigned a hostname other than `healthcrm-api.onrender.com`, update `config.js` to use the exact service URL, commit the change, and redeploy GitHub Pages.
8. In Render, set the backend's `CORS_ORIGINS` to the exact origin of the GitHub Pages site if you keep using that frontend. For this repository it is `https://alekh999.github.io` (origin only; no `/HealthCRM` path).

The backend is configured to run at the same origin as the frontend when you open the Render service URL. This is the recommended way to test the complete stack. The GitHub Pages site can also call the Render API after its URL is configured.

## First account

The Blueprint creates only one administrator at first startup. The username defaults to `admin`; the password is the private `BOOTSTRAP_ADMIN_PASSWORD` supplied during deployment. Sign in and use Settings → User Management to create Doctor and Staff accounts. There are no public demo passwords.

## Local development

Requirements: Node.js 22+ and PostgreSQL.

```bash
cp .env.example .env
# Edit .env. Generate secrets using:
openssl rand -base64 32
npm install
npm start
```

Open `http://localhost:10000`. The `DATABASE_URL` must point at a PostgreSQL database you control.

## AI and patient-report privacy

The assistant and report summarizer use the OpenAI Responses API from the backend. The server sets `store: false`, and it does not save report text or chat contents in this application's database. Report summarization is restricted to Administrator and Doctor roles and requires an explicit confirmation that the report is de-identified and AI processing is authorized.

That setting is not a substitute for your clinic's privacy, security, consent, retention and contractual review. Do not submit identifiable patient reports until you have verified that your chosen AI service and account are approved for that data and applicable requirements. The output is a draft, not a diagnosis or treatment recommendation.

## Important limits before real clinical use

- Render's free PostgreSQL plan expires after 30 days and has no backups. Upgrade to a paid database plan and configure backups before retaining any operational data. The free web service can spin down when idle; upgrade it for a dependable clinic workflow.
- Use HTTPS only. Keep `JWT_SECRET`, `DATA_ENCRYPTION_KEY`, `BOOTSTRAP_ADMIN_PASSWORD`, database credentials and `OPENAI_API_KEY` in the backend secret manager, never in frontend code.
- The current token is held in browser session storage for up to eight hours. For a public production deployment, put the frontend and API behind one controlled origin and move to secure, HttpOnly, SameSite cookies, add MFA, account recovery, session revocation, stronger audit/backup operations and security testing.
- Configure the correct clinic address, telephone, opening hours and verified service information in the backend environment before customers rely on the assistant.
- The report upload currently accepts text, CSV and Markdown. Convert PDF scans to text with an approved workflow before uploading; image/OCR extraction is not enabled.
