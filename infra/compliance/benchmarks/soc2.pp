benchmark "soc2" {
  title       = "SOC 2 Trust Services Criteria (Cloudflare)"
  description = "SOC 2 Security (CC6, CC7, CC8) and Availability (A1) checks for SurveyBeat's Cloudflare account, zones, DNS, Workers, and Access configuration."

  children = [
    benchmark.soc2_cc6_logical_access,
    benchmark.soc2_cc6_boundary_and_transmission,
    benchmark.soc2_cc7_cc8_monitoring_and_change,
    benchmark.soc2_a1_availability_and_storage
  ]

  tags = merge(local.common_tags, {
    framework = "soc2"
    type      = "Benchmark"
  })
}

benchmark "soc2_cc6_logical_access" {
  title       = "CC6.1 - CC6.3: Logical Access Controls"
  description = "Verifies MFA enforcement, member invite hygiene, API token expiration and IP conditions, and Zero Trust Access policies."

  children = [
    control.account_enforce_twofactor,
    control.user_mfa_enabled,
    control.account_member_accepted_and_mfa,
    control.api_token_expiration_set,
    control.api_token_ip_condition,
    control.access_policy_no_unrestricted_bypass
  ]

  tags = merge(local.common_tags, {
    framework = "soc2"
    criteria  = "CC6.1"
  })
}

benchmark "soc2_cc6_boundary_and_transmission" {
  title       = "CC6.6 - CC6.7: Boundary Protection & Transmission Confidentiality"
  description = "Verifies TLS 1.2+/1.3, Strict SSL, HSTS, WAF, browser integrity checks, DNSSEC, CAA, SPF/DMARC, and proxied edge endpoints."

  children = [
    control.zone_ssl_strict,
    control.zone_min_tls_version,
    control.zone_tls_1_3_enabled,
    control.zone_always_use_https,
    control.zone_automatic_https_rewrites,
    control.zone_hsts_enabled,
    control.zone_waf_enabled,
    control.zone_browser_check_enabled,
    control.zone_security_level_appropriate,
    control.zone_leaked_credential_check,
    control.zone_dnssec_enabled,
    control.dns_caa_record_configured,
    control.dns_email_auth_records,
    control.dns_sensitive_records_proxied
  ]

  tags = merge(local.common_tags, {
    framework = "soc2"
    criteria  = "CC6.6_CC6.7"
  })
}

benchmark "soc2_cc7_cc8_monitoring_and_change" {
  title       = "CC7.1 - CC8.1: System Monitoring, Incident Detection & Privacy Isolation"
  description = "Verifies incident alerting, audit logging, RFC 9116 security.txt, and Submission Worker log isolation."

  children = [
    control.account_notification_policy_configured,
    control.audit_log_active,
    control.zone_security_txt_configured,
    control.submission_worker_no_logpush,
    control.submission_worker_no_tail_consumers,
    control.logpush_no_unfiltered_submission_pii
  ]

  tags = merge(local.common_tags, {
    framework = "soc2"
    criteria  = "CC7_CC8"
  })
}

benchmark "soc2_a1_availability_and_storage" {
  title       = "A1.2: Availability & Storage Protection"
  description = "Verifies production zones are active, unpaused, not in development mode, and R2 buckets are inventoried."

  children = [
    control.zone_active_not_paused,
    control.zone_not_development_mode,
    control.r2_bucket_inventory_encryption
  ]

  tags = merge(local.common_tags, {
    framework = "soc2"
    criteria  = "A1.2"
  })
}
