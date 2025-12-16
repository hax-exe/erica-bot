# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do NOT:**
- Open a public GitHub issue
- Discuss the vulnerability publicly before it's fixed

**Do:**
- Email the maintainer directly (if contact info is available)
- Provide detailed steps to reproduce the issue
- Allow reasonable time for a fix before disclosure

## Security Measures

This project implements the following security practices:

### Automated Security
- **Dependabot**: Automated dependency updates and security alerts
- **Dependency Review**: PRs are checked for vulnerable dependencies
- **ESLint Security Rules**: Static analysis for common vulnerabilities

### Code Practices
- Input validation on all user-provided data
- Rate limiting on API endpoints
- SQL injection prevention via parameterized queries (Drizzle ORM)
- Environment variables for sensitive configuration
- No hardcoded secrets or tokens

### Infrastructure
- Docker containers with minimal base images
- Non-root container execution
- Secrets managed via environment variables

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < 1.0   | :x:                |

## Scope

This security policy applies to the Erica Bot codebase. It does not cover:
- Third-party dependencies (report to respective maintainers)
- Discord platform vulnerabilities (report to Discord)
- User-hosted instances with custom modifications
