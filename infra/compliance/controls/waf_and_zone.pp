control "zone_waf_enabled" {
  title       = "Cloudflare zones should have WAF rulesets or WAF protection enabled"
  description = "SOC 2 CC6.6 and GDPR Art. 32 require Web Application Firewall filtering to block common edge exploits."
  severity    = "high"

  sql = <<-EOQ
    with waf_rulesets as (
      select
        zone_id,
        count(*) as ruleset_count
      from
        cloudflare_ruleset
      where
        zone_id is not null
        and phase in (
          'http_request_firewall_managed',
          'http_request_firewall_custom',
          'http_ratelimit'
        )
      group by
        zone_id
    )
    select
      z.id as resource,
      case
        when s.value = 'on' or coalesce(r.ruleset_count, 0) > 0 then 'ok'
        else 'alarm'
      end as status,
      case
        when coalesce(r.ruleset_count, 0) > 0
          then z.name || ' has ' || r.ruleset_count || ' active WAF/rate-limit ruleset(s) (legacy waf=' || coalesce(s.value, 'unset') || ').'
        when s.value = 'on'
          then z.name || ' has legacy WAF setting enabled.'
        else z.name || ' has no WAF rulesets and WAF setting is ' || coalesce(s.value, 'not set') || '.'
      end as reason
    from
      cloudflare_zone as z
      left join cloudflare_zone_setting as s
        on s.zone_id = z.id and s.id = 'waf'
      left join waf_rulesets as r
        on r.zone_id = z.id;
  EOQ

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "BoundaryProtection"
  })
}

control "zone_browser_check_enabled" {
  title       = "Cloudflare zones should enable Browser Integrity Check"
  description = "SOC 2 CC6.6 defense-in-depth check that inspects HTTP headers for abusive clients and automated scanners."
  severity    = "medium"

  sql = <<-EOQ
    select
      z.id as resource,
      case
        when s.value = 'on' then 'ok'
        else 'alarm'
      end as status,
      z.name || ' Browser Integrity Check is ' || coalesce(s.value, 'not set') || '.' as reason
    from
      cloudflare_zone as z
      left join cloudflare_zone_setting as s
        on s.zone_id = z.id and s.id = 'browser_check';
  EOQ

  tags = merge(local.common_tags, {
    soc2     = "true"
    category = "BoundaryProtection"
  })
}

control "zone_security_level_appropriate" {
  title       = "Cloudflare zones should not set Security Level to essentially_off"
  description = "Ensures baseline IP reputation challenge protection remains enabled for SOC 2 CC6.6."
  severity    = "medium"

  sql = <<-EOQ
    select
      z.id as resource,
      case
        when s.value is null or s.value = 'essentially_off' then 'alarm'
        else 'ok'
      end as status,
      z.name || ' Security Level is ' || coalesce(s.value, 'not set') || '.' as reason
    from
      cloudflare_zone as z
      left join cloudflare_zone_setting as s
        on s.zone_id = z.id and s.id = 'security_level';
  EOQ

  tags = merge(local.common_tags, {
    soc2     = "true"
    category = "BoundaryProtection"
  })
}

control "zone_leaked_credential_check" {
  title       = "Cloudflare zones should enable Leaked Credential Checks where plan supports it"
  description = "Detects compromised credentials at the edge (SOC 2 CC6.6)."
  severity    = "low"

  sql = <<-EOQ
    select
      id as resource,
      case
        when leaked_credential_check_enabled is true then 'ok'
        else 'info'
      end as status,
      case
        when leaked_credential_check_enabled is true
          then name || ' has Leaked Credential Check enabled.'
        else name || ' has Leaked Credential Check disabled (verify plan eligibility).'
      end as reason
    from
      cloudflare_zone;
  EOQ

  tags = merge(local.common_tags, {
    soc2     = "true"
    category = "BoundaryProtection"
  })
}

control "zone_security_txt_configured" {
  title       = "Cloudflare zones should publish RFC 9116 security.txt"
  description = "SOC 2 CC7.2 vulnerability disclosure readiness: publishes security contact metadata at /.well-known/security.txt."
  severity    = "low"

  sql = <<-EOQ
    select
      id as resource,
      case
        when coalesce((security_txt ->> 'enabled')::boolean, false) is true then 'ok'
        else 'alarm'
      end as status,
      case
        when coalesce((security_txt ->> 'enabled')::boolean, false) is true
          then name || ' publishes security.txt.'
        else name || ' does not have security.txt enabled.'
      end as reason
    from
      cloudflare_zone;
  EOQ

  tags = merge(local.common_tags, {
    soc2     = "true"
    category = "VulnerabilityManagement"
  })
}

control "zone_active_not_paused" {
  title       = "Cloudflare zones must be active and not paused"
  description = "SOC 2 A1.2 / CC6.6: pausing a zone bypasses Cloudflare proxy, WAF, and TLS protections."
  severity    = "critical"

  sql = <<-EOQ
    select
      id as resource,
      case
        when status = 'active' and coalesce(paused, false) is false then 'ok'
        else 'alarm'
      end as status,
      name || ' status is ' || coalesce(status, 'unknown') || ', paused=' || coalesce(paused::text, 'false') || '.' as reason
    from
      cloudflare_zone;
  EOQ

  tags = merge(local.common_tags, {
    soc2     = "true"
    category = "Availability"
  })
}

control "zone_not_development_mode" {
  title       = "Cloudflare zones must not remain in Development Mode"
  description = "SOC 2 A1.2 / CC8.1: Development Mode temporarily bypasses Cloudflare edge caching and increases origin exposure."
  severity    = "medium"

  sql = <<-EOQ
    select
      id as resource,
      case
        when coalesce(development_mode, 0) = 0 then 'ok'
        else 'alarm'
      end as status,
      case
        when coalesce(development_mode, 0) = 0 then name || ' is not in Development Mode.'
        else name || ' has Development Mode active (' || development_mode || 's remaining).'
      end as reason
    from
      cloudflare_zone;
  EOQ

  tags = merge(local.common_tags, {
    soc2     = "true"
    category = "Availability"
  })
}
