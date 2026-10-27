# Private creator registrations

Before entering either studio, each new session asks for a name, valid email address, and acknowledgement of the data notice. Refreshes and regenerations reuse that session's registration. **Start a new reel** creates a fresh session for the next visitor. Existing sessions without a registration are prompted on reload; every render-creation API also enforces registration.

Names and emails are saved on the host in `DATA_DIR/registrations/<session-id>.json`, separately from footage. They are not put in public assets, URLs, job responses, QR pages or aggregate analytics. Email syntax is checked; email ownership is not verified, and no emails are sent.

`REGISTRATION_RETENTION_DAYS` defaults to 30 (1–365). Expired records are excluded from exports immediately and removed by the existing startup/minute cleanup while the host runs. Session media still uses its existing retention. Private CSV snapshots are separate copies: delete them manually when no longer needed.

## Get your CSV on this laptop

```powershell
powershell -ExecutionPolicy Bypass -File deploy/export-registrations.ps1
```

This defaults to the live laptop host's `data/hosted-studio` folder and prints the new CSV path under `data/hosted-studio/private-exports`. Run it again for an up-to-date export. For another host or data directory, pass `-DataDir <absolute folder>` or set `DATA_DIR` and use `npm run export:registrations`.

Columns: Name, Email, Session ID, Registered at (UTC), Expires at (UTC). There is one row per registered session, so the same person can appear more than once if they start multiple sessions. Spreadsheet formula prefixes are escaped. Exported CSVs remain git-ignored and are never served as public media.

The authenticated operator page also has **Download private registrations CSV**. It uses the existing operator credential; the public tunnel still blocks the whole operator area. The local export command works without setting up operator login.

## Verification

`npm run verify:registration` covers invalid input, required acknowledgement, unauthorized reads/writes/export, generation before registration, duplicate retries, expiry and CSV escaping. Browser tests in `tests/browser/registration.spec.ts` cover entry, refresh and failed-save recovery. Public smoke verification submits clearly named synthetic test registration data before rendering.
