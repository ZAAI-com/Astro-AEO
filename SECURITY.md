# Security Policy

## Supported versions

Security fixes are provided for the latest published minor release. When practical, a fix that
does not require a breaking API change is also backported to the preceding minor release.

| Version | Supported |
| --- | --- |
| Latest 1.x minor | Yes |
| Previous 1.x minor | Best effort |
| Older releases | No |

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in a public issue, discussion, or pull request.
Use GitHub's private vulnerability reporting for this repository:

https://github.com/ZAAI-com/Astro-AEO/security/advisories/new

Include the affected version, deployment/runtime, reproduction steps, expected impact, and any
suggested mitigation. Avoid including production secrets or personal data. Maintainers will
acknowledge a complete report within five business days and will coordinate remediation and
disclosure through the private advisory.

Astro-AEO processes rendered HTML and writes public artifacts, so reports involving path
traversal, marker disclosure, unsafe HTML retention, authentication bypass, secret leakage, or
cross-runtime bundle execution are especially helpful.
