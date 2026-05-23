# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x     | ✅ Active  |
| < 2.0   | ❌ EOL     |

## Reporting a Vulnerability

Email **security@360ops.ai** with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

We respond within 48 hours and aim to patch within 7 days.
Do not open a public GitHub issue for security vulnerabilities.

## Expected Permissions

360router intentionally uses the following system capabilities:

| Permission | Reason |
|---|---|
| **Network access** | Routes requests to local and cloud AI providers |
| **Shell access** | Installs OS auto-start services (systemd / launchd / Startup folder) and self-updates via npm |
| **File system** | Reads/writes provider config (`~/.360router/config.json`) and app config backups |

These are core to the product's function and are disclosed here for transparency.
