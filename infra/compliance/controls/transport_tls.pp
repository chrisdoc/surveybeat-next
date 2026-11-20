control "zone_ssl_strict" {
  title       = "Cloudflare zones should enforce Full (strict) SSL/TLS mode"
  description = "GDPR Art. 32 and SOC 2 CC6.7 require end-to-end encrypted transport with origin certificate validation (ssl = 'strict')."
  severity    = "critical"

  sql = <<-EOQ
    select
      z.id as resource,
      case
        when s.value = 'strict' then 'ok'
        else 'alarm'
      end as status,
      z.name || ' SSL/TLS mode is ' || coalesce(s.value, 'not set') || '.' as reason
    from
      cloudflare_zone as z
      left join cloudflare_zone_setting as s
        on s.zone_id = z.id and s.id = 'ssl'
    where
      '*' = any($1::text[]) or z.name = any($1::text[]);
  EOQ

  param "target_zones" {
    default = var.target_zones
  }

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "EncryptionInTransit"
  })
}

control "zone_min_tls_version" {
  title       = "Cloudflare zones should enforce minimum TLS version 1.2 or 1.3"
  description = "GDPR Art. 32 and SOC 2 CC6.7 disallow deprecated TLS 1.0 and 1.1 protocols."
  severity    = "high"

  sql = <<-EOQ
    select
      z.id as resource,
      case
        when s.value in ('1.2', '1.3') then 'ok'
        else 'alarm'
      end as status,
      z.name || ' minimum TLS version is ' || coalesce(s.value, 'not set') || '.' as reason
    from
      cloudflare_zone as z
      left join cloudflare_zone_setting as s
        on s.zone_id = z.id and s.id = 'min_tls_version'
    where
      '*' = any($1::text[]) or z.name = any($1::text[]);
  EOQ

  param "target_zones" {
    default = var.target_zones
  }

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "EncryptionInTransit"
  })
}

control "zone_tls_1_3_enabled" {
  title       = "Cloudflare zones should have TLS 1.3 enabled"
  description = "Enforces modern cipher suites and forward secrecy for GDPR Art. 32 and SOC 2 CC6.7."
  severity    = "medium"

  sql = <<-EOQ
    select
      z.id as resource,
      case
        when s.value in ('on', 'zrt') then 'ok'
        else 'alarm'
      end as status,
      z.name || ' TLS 1.3 setting is ' || coalesce(s.value, 'not set') || '.' as reason
    from
      cloudflare_zone as z
      left join cloudflare_zone_setting as s
        on s.zone_id = z.id and s.id = 'tls_1_3'
    where
      '*' = any($1::text[]) or z.name = any($1::text[]);
  EOQ

  param "target_zones" {
    default = var.target_zones
  }

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "EncryptionInTransit"
  })
}

control "zone_always_use_https" {
  title       = "Cloudflare zones should enable Always Use HTTPS"
  description = "Redirects all plaintext HTTP requests to HTTPS at the edge (GDPR Art. 32, SOC 2 CC6.7)."
  severity    = "high"

  sql = <<-EOQ
    select
      z.id as resource,
      case
        when s.value = 'on' then 'ok'
        else 'alarm'
      end as status,
      z.name || ' Always Use HTTPS is ' || coalesce(s.value, 'not set') || '.' as reason
    from
      cloudflare_zone as z
      left join cloudflare_zone_setting as s
        on s.zone_id = z.id and s.id = 'always_use_https'
    where
      '*' = any($1::text[]) or z.name = any($1::text[]);
  EOQ

  param "target_zones" {
    default = var.target_zones
  }

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "EncryptionInTransit"
  })
}

control "zone_automatic_https_rewrites" {
  title       = "Cloudflare zones should enable Automatic HTTPS Rewrites"
  description = "Prevents mixed-content leaks by rewriting insecure HTTP links to HTTPS (GDPR Art. 32, SOC 2 CC6.7)."
  severity    = "low"

  sql = <<-EOQ
    select
      z.id as resource,
      case
        when s.value = 'on' then 'ok'
        else 'alarm'
      end as status,
      z.name || ' Automatic HTTPS Rewrites is ' || coalesce(s.value, 'not set') || '.' as reason
    from
      cloudflare_zone as z
      left join cloudflare_zone_setting as s
        on s.zone_id = z.id and s.id = 'automatic_https_rewrites'
    where
      '*' = any($1::text[]) or z.name = any($1::text[]);
  EOQ

  param "target_zones" {
    default = var.target_zones
  }

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "EncryptionInTransit"
  })
}

control "zone_hsts_enabled" {
  title       = "Cloudflare zones should enable HSTS with max-age >= 6 months and nosniff"
  description = "Enforces HTTP Strict Transport Security so browsers refuse downgrade attacks on surveybeat.app (GDPR Art. 32, SOC 2 CC6.7)."
  severity    = "high"

  sql = <<-EOQ
    with parsed as (
      select
        z.id,
        z.name,
        case
          when s.value is null then null
          when s.value ~ '^\s*\{"' then s.value::jsonb -> 'strict_transport_security'
          when s.value ~ 'StrictTransportSecurity:\{raw:\{' then substring(s.value from 'StrictTransportSecurity:\{raw:(\{[^}]+\})')::jsonb
          else null
        end as hsts
      from
        cloudflare_zone as z
        left join cloudflare_zone_setting as s
          on s.zone_id = z.id and s.id = 'security_header'
      where
        '*' = any($1::text[]) or z.name = any($1::text[])
    )
    select
      id as resource,
      case
        when hsts is null then 'alarm'
        when coalesce((hsts ->> 'enabled')::boolean, false) is false then 'alarm'
        when coalesce((hsts ->> 'max_age')::bigint, 0) < 15552000 then 'alarm'
        when coalesce((hsts ->> 'nosniff')::boolean, false) is false then 'alarm'
        else 'ok'
      end as status,
      case
        when hsts is null then name || ' has no security_header HSTS configuration.'
        when coalesce((hsts ->> 'enabled')::boolean, false) is false then name || ' has HSTS disabled.'
        when coalesce((hsts ->> 'max_age')::bigint, 0) < 15552000
          then name || ' HSTS max_age is ' || coalesce(hsts ->> 'max_age', '0') || 's (expected >= 15552000s).'
        when coalesce((hsts ->> 'nosniff')::boolean, false) is false
          then name || ' HSTS has X-Content-Type-Options nosniff disabled.'
        else name || ' has HSTS enabled (max_age=' || (hsts ->> 'max_age') || 's, include_subdomains=' || coalesce(hsts ->> 'include_subdomains', 'false') || ', nosniff=true).'
      end as reason
    from
      parsed;
  EOQ

  param "target_zones" {
    default = var.target_zones
  }

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "EncryptionInTransit"
  })
}
