# Change Record

**Title:** Azure subscription migration: Visual Studio Enterprise to Azure for Students
**Project:** ArkiLaunch
**Date:** 2026-11-17
**Version:** 0.1
**Status:** Code and docs changed; nothing applied to any subscription yet
**Trigger:** The Visual Studio Enterprise subscription became inaccessible.
**Docs touched by this record:** [index.md](index.md) §2

## Why

Checked 2026-11-17:

- `az` authentication to the owning tenant fails with `AADSTS5000224: this resource is not available`, so the subscription, its Terraform state and the deploy identity are all unreachable.
- The dev Document Intelligence endpoint answers `401` and the dev API FQDN times out.
- `starkilaunchtfstate`, `acrarkilaunchdev` and `di-arkilaunch-dev` still resolve in DNS. Those names are globally unique, so a new subscription cannot reuse them.

## What changed

- State storage account `starkilaunchtfstate` becomes `starkilaunchtfstate2` (bootstrap).
- Container registry `acrarkilaunch<env>` becomes `acrarkilaunch<env>2` in dev, prod and `deploy.yml`.
- Dev Document Intelligence `di-arkilaunch-dev` becomes `di-arkilaunch-dev2`. Prod's name was never taken and is unchanged.
- Bootstrap README gains a re-bootstrap section. `.env.example` key lookup hint updated.

No application code, schema or feature flag changes. The Document Intelligence client is a plain REST client and telemetry reads a connection string, so both are subscription-agnostic.

## Cutover checklist (run by hand)

1. `az login` with the student account, then `az account set --subscription <id>`.
2. Move `infra/terraform/bootstrap/terraform.tfstate*` aside, then `terraform init && terraform apply -var subscription_id=<id> -var github_subject_prefix=<from gh api>`.
3. Set GitHub `dev` environment variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` from bootstrap outputs, and `TF_STATE_STORAGE_ACCOUNT=starkilaunchtfstate2`.
4. Push the image to `acrarkilaunchdev2`, run `pnpm db:migrate`, then `terraform init -backend-config="storage_account_name=starkilaunchtfstate2"` and `terraform apply -var image_tag=<sha>` with the `TF_VAR_*` secrets exported.
5. Put the new `terraform output api_fqdn` into the `VITE_API_BASE_URL` variable and the web worker's `API_BASE_URL`, then redeploy web.
6. Refresh local `.env` `AZURE_DI_ENDPOINT` and `AZURE_DI_KEY` from the new resource.
7. If Container Apps or Cognitive Services is refused in `southeastasia` under student quota, retry with `-var location=<region>`.

## Not claimed

- Nothing has been applied. The new subscription has not been touched and the backend is still down until the checklist is run.
- GitHub Actions is billing-locked (`startup_failure`), so the first deploy is manual. CI is unchanged.
- Secrets were not rotated, by owner decision: access was lost, not known to be breached.
- AIA-R7 (cross-border processing) is unchanged. If the region changes, it needs revisiting.
- Prod remains unprovisioned.
- Historical records keep the old names on purpose.
