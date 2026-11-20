benchmark "gdpr" {
  title       = "GDPR (Cloudflare Infrastructure Controls)"
  description = "GDPR technical and organizational measures (Art. 5, 25, 32, 33) verified against Cloudflare via Steampipe turbot/cloudflare, aligned with SurveyBeat SPEC §5.3 & §7."

  children = [
    benchmark.gdpr_privacy_by_design,
    benchmark.gdpr_security_of_processing,
    benchmark.gdpr_audit_and_monitoring
  ]

  tags = merge(local.common_tags, {
    framework = "gdpr"
    type      = "Benchmark"
  })
}

benchmark "gdpr_privacy_by_design" {
  title       = "Articles 5 & 25: Data Minimization and Privacy by Design"
  description = "Ensures SurveyBeat's anonymous Submission Worker and Logpush pipelines do not retain or export identifying request telemetry."

  children = [
    control.submission_worker_no_logpush,
    control.submission_worker_no_tail_consumers,
    control.logpush_no_unfiltered_submission_pii
  ]

  tags = merge(local.common_tags, {
    framework = "gdpr"
    article   = "art_5_art_25"
  })
}

benchmark "gdpr_security_of_processing" {
  title       = "Article 32: Security of Processing"
  description = "Ensures strong encryption in transit, edge WAF protection, DNS integrity, email authentication, and strong operator access controls."

  children = [
    control.zone_ssl_strict,
    control.zone_min_tls_version,
    control.zone_tls_1_3_enabled,
    control.zone_always_use_https,
    control.zone_automatic_https_rewrites,
    control.zone_hsts_enabled,
    control.zone_waf_enabled,
    control.zone_dnssec_enabled,
    control.dns_email_auth_records,
    control.dns_sensitive_records_proxied,
    control.account_enforce_twofactor,
    control.user_mfa_enabled,
    control.api_token_expiration_set,
    control.access_policy_no_unrestricted_bypass,
    control.r2_bucket_inventory_encryption
  ]

  tags = merge(local.common_tags, {
    framework = "gdpr"
    article   = "art_32"
  })
}

benchmark "gdpr_audit_and_monitoring" {
  title       = "Article 33: Auditability and Incident Detection"
  description = "Verifies audit logging and account incident notification policies are active."

  children = [
    control.account_notification_policy_configured,
    control.audit_log_active
  ]

  tags = merge(local.common_tags, {
    framework = "gdpr"
    article   = "art_33"
  })
}
