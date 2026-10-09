<p align="center">
  <img src="apps/web/public/icons/mark.svg" alt="ArkiLaunch logo" width="120" height="120">
</p>

<h1 align="center">ArkiLaunch</h1>

<p align="center">
  The operating system for Philippine heavy-equipment rental MSMEs.<br>
  Scan handwritten field logs, quote against live diesel in under a minute, and flag weather risk on site.
</p>

<p align="center">
  <img alt="React" src="https://img.shields.io/badge/React_19-20232A?logo=react&logoColor=61DAFB">
  <img alt="Vite" src="https://img.shields.io/badge/Vite_8-646CFF?logo=vite&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS_11-E0234E?logo=nestjs&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node_24-5FA04E?logo=nodedotjs&logoColor=white">
  <br>
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white">
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white">
  <img alt="Drizzle ORM" src="https://img.shields.io/badge/Drizzle_ORM-C5F74F?logo=drizzle&logoColor=black">
  <img alt="Azure AI Document Intelligence" src="https://img.shields.io/badge/Azure_Document_Intelligence-0078D4?logo=microsoftazure&logoColor=white">
  <br>
  <img alt="PayMongo" src="https://img.shields.io/badge/PayMongo-0E7C4A">
  <img alt="Open-Meteo" src="https://img.shields.io/badge/Open--Meteo-FF8C00">
  <img alt="Azure Container Apps" src="https://img.shields.io/badge/Azure_Container_Apps-0078D4?logo=microsoftazure&logoColor=white">
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white">
</p>

<p align="center">
  <sub>API and jobs run on <b>Azure Container Apps</b> · web served from <b>Cloudflare Workers</b> at arkilaunch.app</sub>
</p>

<p align="center">
  <a href="docs/index.md">Docs</a> ·
  <a href="docs/runbook-local-dev.md">Local dev</a> ·
  <a href="docs/pitch-arkilaunch.md">Demo</a>
</p>

---

## What it does

- Scans handwritten Equipment Daily Time Reports (EDTRs) with OCR and reconciles two independent logs before any deposit is deducted (PRD-F3).
- Generates diesel-indexed rental quotes in under a minute (PRD-F1).
- Manages a multi-tenant fleet with maintenance timers, weather-aware liability logging, and OCR-assisted KYC (PRD-F4, F5, F6).
- Takes bookings and payments through an authenticated customer portal (PRD-F2, F8).

## Quick start

```bash
cp .env.example .env   # Supabase pooler URLs + RS256 keypair; see comments in the file
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm build && pnpm test
```

Full setup is in [docs/runbook-local-dev.md](docs/runbook-local-dev.md). Read [docs/index.md](docs/index.md) first: it is the doc manifest and lists which specs are Locked.

## Status

Backends for all eight features (F1..F8) are built and tested. The pilot is not yet deployed, and OCR has not yet been validated on real handwriting. [docs/index.md](docs/index.md) §4 is the authoritative Health Check.

## License

All rights reserved pending resolution of capstone IP ownership (CLR E10). See [LICENSE](LICENSE).
