CREATE INDEX IF NOT EXISTS weather_alerts_retention_idx ON weather_alerts (tenant_id, effective_at);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS events_edtr_weather_history_unique_idx ON events (tenant_id, (properties ->> 'edtr_id')) WHERE name = 'edtr_weather_history';--> statement-breakpoint
