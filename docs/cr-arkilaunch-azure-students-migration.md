# Change Record

**Title:** Azure subscription migration: Visual Studio Enterprise to Azure for Students
**Project:** ArkiLaunch
**Date:** 2026-11-17
**Version:** 0.1
**Status:** Applied to Azure for Students (dev). Frontend redeploy and prod are outstanding
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

## Applied 2026-11-17 (dev)

Bootstrap, registry, Log Analytics, Document Intelligence (`di-arkilaunch-dev2`), Container Apps environment, the API app and nine cron jobs now exist in the Azure for Students subscription. `/health` returns 200, CORS allows the web origin, and Document Intelligence answers on `prebuilt-layout`.

Findings that changed the plan:

- **Region is `japaneast`, not `southeastasia`.** A subscription policy allows only centralindia, japaneast, koreacentral, malaysiawest and japanwest. Japan East offers every service used here. AIA-R7 (cross-border processing) is unchanged in kind but now concerns Japan.
- **Express environments.** Azure created the Container Apps environment in Express mode, which rejects ACA Jobs. The azurerm provider cannot request another mode, so the dev environment was created once with `az containerapp env create --environment-mode WorkloadProfiles` and imported into state. The module also declares the Consumption workload profile so the import plans clean. A fresh subscription must repeat that step before the first apply. The subscription also allows only one environment per region.
- **ACR Tasks is blocked** on student subscriptions, so the image is built with local Docker and pushed. Build from a clean checkout of the commit.
- **Turnstile is off in dev** (`enable_turnstile = false`) because the secret could not be recovered. Re-enable it once the secret is available. Until then the API does not verify Turnstile tokens.
- **Payments secrets.** The API refuses to boot with `ENABLE_PAYMENTS=true` and no PayMongo secrets. They were supplied from the local environment as test-mode keys.

## Still open

- The web worker still needs a redeploy against the new API address. The GitHub variable is updated, but Actions is billing-locked.
- Prod is not provisioned.

## Not claimed

- No end-to-end user flow was exercised. Only health, CORS and Document Intelligence were probed.
- GitHub Actions is billing-locked (`startup_failure`), so the first deploy is manual. CI is unchanged.
- Secrets were not rotated, by owner decision: access was lost, not known to be breached.
- AIA-R7 (cross-border processing) is unchanged. If the region changes, it needs revisiting.
- Prod remains unprovisioned.
- Historical records keep the old names on purpose.
