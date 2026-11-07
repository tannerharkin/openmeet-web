# Security Policy

## Supported versions

Only the latest `main`, as deployed to https://openmeet.tannerharkin.com, is supported. Fixes are not backported.

## Reporting a vulnerability

Please report privately through GitHub's private vulnerability reporting:
https://github.com/tannerharkin/openmeet-web/security/advisories/new

Please don't open a public issue for security problems.

## Scope

In scope:

- The web page itself (anything served from openmeet.tannerharkin.com)
- The build and deploy pipeline (this repository's GitHub Actions workflows and dependencies)
- The protocol layer in `src/protocol/` (how commands are framed, sent and how replies are parsed)

Out of scope (please report upstream):

- Shokz firmware or hardware (OpenMeet headset, Loop120 dongle) and the Shokz Connect app: see the Shokz disclosure page, https://uk.shokz.com/pages/safety-updates-and-announcements
- Issues in GitHub, GitHub Pages, or Chrome/Edge and WebHID themselves

## Expectations

This is a best-effort hobby project. Reports are read and fixed as time allows; there is no bug bounty.

## Security model

There is no backend, account or telemetry. The page is one self-contained file (React included) and loads nothing from other origins. The page only sends the command set defined in `src/protocol/frames.ts` to the dongle. However, once you grant the page access to a dongle, the browser remembers that permission for the origin, so anyone who could control the origin's content could use the granted dongle. To revoke access, use the app's **Forget this dongle** button, or remove the device in Chrome/Edge site settings → HID devices (`chrome://settings/content/hidDevices`).
