resource "azurerm_container_app_environment" "this" {
  name                       = var.name
  resource_group_name        = var.resource_group_name
  location                   = var.location
  log_analytics_workspace_id = var.log_analytics_workspace_id
  tags                       = var.tags

  # Declared explicitly: without it Azure for Students creates an Express
  # environment, which rejects ACA Jobs (ExpressEnvironmentResourceNotSupported).
  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}
