# Change Record

**Title:** Azure subscription migration: Visual Studio Enterprise to Azure for Students
**Project:** ArkiLaunch
**Date:** 2026-11-17
**Version:** 0.1
**Status:** Applied to Azure for Students (dev), deployed from the org repo with the web worker redeployed. Prod is outstanding
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

## Applied 2026-11-17 (GitHub org move)

Actions on `r0undy/arkilaunch` is billing-locked, so CI/CD moves to the public repo `arkilaunch/arkilaunch-stdnt` in the `arkilaunch` org (Free plan).

- **History is kept.** The org repo's `main` is the personal repo's `main` at `a03c78e`, with all commits. Feature branches were not moved.
- **OIDC.** Federated credentials `arkilaunch-stdnt-github-{dev,prod}` were added to `id-arkilaunch-github-deploy` with `az identity federated-credential create`. Subject: `repo:arkilaunch@357659016/arkilaunch-stdnt@1461121871:environment:<env>`, from `gh api repos/arkilaunch/arkilaunch-stdnt/actions/oidc/customization/sub`. The old repo's two credentials stay. The bootstrap Terraform state is local and not in this checkout, so these two credentials are **drift from `infra/terraform/bootstrap`**. Import them, or add a second subject prefix, before the next bootstrap apply.
- **GitHub environments.**
  - `dev` carries the Azure/state variables, `VITE_API_BASE_URL`, `VITE_TURNSTILE_SITE_KEY` and `CLOUDFLARE_ACCOUNT_ID`, plus the 11 `deploy.yml` secrets.
  - `prod` carries only the Azure/state variables.
- **Deploy.** A push to `dev` builds and pushes the image, migrates, applies dev Terraform, and redeploys the `arkilaunch-web` worker against the Japan East API.

## Still open

- **Two repos can deploy.** The old repo's credentials still trust `r0undy/arkilaunch` by owner decision. If its Actions unlocks, the two repos can overwrite each other's image tags.
- **PayMongo webhook** still points at the old `southeastasia` FQDN, so payment confirmations do not arrive. Fix it by re-registering at `…japaneast.azurecontainerapps.io/api/v1/webhooks/paymongo` and updating `PAYMONGO_WEBHOOK_SECRET`.
- **VAPID.** `deploy.yml` does not pass `TF_VAR_vapid_private_key`, so push notifications stay off.
- Prod is not provisioned.

## Not claimed

- No end-to-end user flow was exercised. Only health, CORS and Document Intelligence were probed.
- The first deploy was manual because GitHub Actions on the personal repo is billing-locked (`startup_failure`). Later deploys run from the org repo. CI is unchanged.
- Secrets were not rotated, by owner decision: access was lost, not known to be breached.
- AIA-R7 (cross-border processing) is unchanged. If the region changes, it needs revisiting.
- Prod remains unprovisioned.
- Historical records keep the old names on purpose.
