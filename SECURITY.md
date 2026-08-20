# Security Policy

## Supported Versions

This is a single-maintainer personal project with no versioned releases —
only the `main` branch is supported. Security fixes are applied there.

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, use GitHub's private vulnerability reporting for this repository:

1. Go to the **Security** tab.
2. Click **Report a vulnerability** under "Advisories".
3. Fill in the details of the issue.

This opens a private discussion with the maintainer that isn't visible to
other users until a fix is available.

If private reporting is not enabled for this repository, please reach out to
the maintainer through their GitHub profile instead of filing a public issue.

## Scope

This repository ingests personal Garmin health/fitness data and deploys
infrastructure to a private GCP project. Reports involving credential
handling, token storage (`.garth`, Garmin OAuth tokens, Firebase service
account keys), Firestore security rules (`app/firestore.rules`), or the
GitHub Actions deployment workflows (`.github/workflows/`) are especially
appreciated.
