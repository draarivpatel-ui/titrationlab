# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/titrationlab/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static TitrationLab browser application, including titration solver input validation, chart and meter rendering, print output, local serving scripts and browser-side state handling.

In scope:

- A cross-site scripting or HTML injection path through titration inputs, imported text, generated output or browser rendering.
- A solver or serialization flaw that bypasses validation, corrupts another calculation, or executes attacker-controlled code.
- A print, export or display flaw that makes generated output execute a formula or script when opened.
- A local serving or static-file handling flaw that exposes files outside the intended application directory.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- The accuracy limits documented for the educational chemistry model, unless a report shows a specific validation or output integrity failure.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
