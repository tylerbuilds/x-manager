# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | Yes                |

## Reporting a Vulnerability

If you discover a security vulnerability in X-Manager, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Email the maintainers or open a private security advisory via GitHub's [Security Advisories](https://docs.github.com/en/code-security/security-advisories) feature.
3. Include a description of the vulnerability, steps to reproduce, and any potential impact.

We aim to acknowledge reports within 48 hours and provide a fix within 7 days for critical issues.

## Security Design

X-Manager takes security seriously as a self-hosted application that handles OAuth credentials:

- **Encryption at rest**: All stored API keys and OAuth tokens are encrypted using AES-256-GCM with authenticated encryption.
- **Session security**: Admin sessions use HMAC-SHA256 signed cookies with configurable TTL.
- **Constant-time comparisons**: All token/password validations use `crypto.timingSafeEqual` to prevent timing attacks.
- **SSRF protection**: Media fetches and webhook deliveries validate URLs against private network ranges.
- **Rate limiting**: Per-client rate limiting on sensitive endpoints.
- **Boot hardening**: Production mode refuses to start without proper encryption keys configured.
- **Replay protection**: Bridge API supports HMAC-signed requests with timestamp verification.

## Best Practices for Self-Hosting

1. **Always set `X_MANAGER_ENCRYPTION_KEY`** with a strong random value (32+ bytes).
2. **Always set `X_MANAGER_ADMIN_TOKEN`** with a long, random password.
3. **Run behind a reverse proxy** (nginx, Caddy) with HTTPS in production.
4. **Restrict network access** -- only expose the app on trusted networks or via VPN.
5. **Keep dependencies updated** -- run `npm audit` periodically.
