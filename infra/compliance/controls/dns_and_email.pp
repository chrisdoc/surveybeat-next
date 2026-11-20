control "zone_dnssec_enabled" {
  title       = "Cloudflare zones should have DNSSEC active"
  description = "GDPR Art. 32 and SOC 2 CC6.6: DNSSEC protects surveybeat.app against DNS spoofing and cache poisoning."
  severity    = "high"

  sql = <<-EOQ
    select
      id as resource,
      case
        when dnssec ->> 'status' = 'active' then 'ok'
        else 'alarm'
      end as status,
      name || ' DNSSEC status is ' || coalesce(dnssec ->> 'status', 'disabled') || '.' as reason
    from
      cloudflare_zone
    where
      '*' = any($1::text[]) or name = any($1::text[]);
  EOQ

  param "target_zones" {
    default = var.target_zones
  }

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "DNSIntegrity"
  })
}

control "dns_caa_record_configured" {
  title       = "Cloudflare zones should define CAA DNS records"
  description = "SOC 2 CC6.6: Certification Authority Authorization (CAA) records restrict which CAs may issue TLS certificates for surveybeat.app."
  severity    = "medium"

  sql = <<-EOQ
    select
      z.id as resource,
      case
        when coalesce(c.caa_count, 0) > 0 then 'ok'
        else 'alarm'
      end as status,
      case
        when coalesce(c.caa_count, 0) > 0 then z.name || ' has ' || c.caa_count || ' CAA record(s).'
        else z.name || ' has no CAA records configured.'
      end as reason
    from
      cloudflare_zone as z
      left join lateral (
        select count(*) as caa_count
        from cloudflare_dns_record
        where zone_id = z.id and type = 'CAA'
      ) as c on true
    where
      '*' = any($1::text[]) or z.name = any($1::text[]);
  EOQ

  param "target_zones" {
    default = var.target_zones
  }

  tags = merge(local.common_tags, {
    soc2     = "true"
    category = "DNSIntegrity"
  })
}

control "dns_email_auth_records" {
  title       = "Cloudflare zones should publish unique SPF and DMARC DNS records"
  description = "GDPR Art. 32 and SOC 2 CC6.6: protects SurveyBeat invitation and email-code sign-in flows from domain spoofing and detects duplicate DMARC records."
  severity    = "high"

  sql = <<-EOQ
    select
      z.id as resource,
      case
        when coalesce(t.has_root_spf, false)
          and t.root_dmarc_count = 1
          and coalesce(t.has_notify_spf, false)
          and t.notify_dmarc_count = 1 then 'ok'
        else 'alarm'
      end as status,
      z.name
        || ' root SPF=' || coalesce(t.has_root_spf::text, 'false')
        || ', root DMARC records=' || coalesce(t.root_dmarc_count, 0)
        || ', notify SPF=' || coalesce(t.has_notify_spf::text, 'false')
        || ', notify DMARC records=' || coalesce(t.notify_dmarc_count, 0)
        || '.' as reason
    from
      cloudflare_zone as z
      left join lateral (
        select
          bool_or(r.name = z.name and replace(r.content, '"', '') ilike 'v=spf1%') as has_root_spf,
          count(*) filter (where r.name = '_dmarc.' || z.name and replace(r.content, '"', '') ilike 'v=DMARC1%') as root_dmarc_count,
          bool_or((r.name = 'notify.' || z.name or r.name = 'cf-bounce.notify.' || z.name) and replace(r.content, '"', '') ilike 'v=spf1%') as has_notify_spf,
          count(*) filter (where r.name = '_dmarc.notify.' || z.name and replace(r.content, '"', '') ilike 'v=DMARC1%') as notify_dmarc_count
        from cloudflare_dns_record as r
        where r.zone_id = z.id and r.type = 'TXT'
      ) as t on true
    where
      '*' = any($1::text[]) or z.name = any($1::text[]);
  EOQ

  param "target_zones" {
    default = var.target_zones
  }

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "EmailSecurity"
  })
}

control "dns_sensitive_records_proxied" {
  title       = "SurveyBeat web and submission DNS records must be proxied through Cloudflare"
  description = "Ensures A/AAAA/CNAME records for surveybeat.app, dashboard, and submit hosts route through Cloudflare WAF and TLS termination (GDPR Art. 32, SOC 2 CC6.6)."
  severity    = "high"

  sql = <<-EOQ
    with target_zones as (
      select id, name
      from cloudflare_zone
      where '*' = any($1::text[]) or name = any($1::text[])
    ),
    zone_records as (
      select
        z.name as zone_name,
        r.id,
        r.name,
        r.type,
        r.proxied,
        r.proxiable
      from
        target_zones as z
        join cloudflare_dns_record as r on r.zone_id = z.id
      offset 0
    ),
    app_records as (
      select
        id,
        zone_name,
        name,
        type,
        proxied
      from
        zone_records
      where
        type in ('A', 'AAAA', 'CNAME')
        and proxiable is true
        and name ~ ('^(www\.|app\.|dashboard\.|submit\.|staging\.|staging\.dashboard\.|staging\.submit\.|pr-[0-9]+\.|pr-[0-9]+\.dashboard\.|pr-[0-9]+\.submit\.)?' || replace(zone_name, '.', '\.') || '$')
    )
    select
      r.id as resource,
      case
        when r.proxied is true then 'ok'
        else 'alarm'
      end as status,
      r.type || ' record ' || r.name || ' is ' || case when r.proxied is true then 'proxied.' else 'DNS-only (unproxied).' end as reason
    from
      app_records as r
    union all
    select
      z.id as resource,
      'info' as status,
      'No proxiable app/submit A, AAAA, or CNAME DNS records found in zone ' || z.name || '.' as reason
    from
      target_zones as z
    where
      not exists (select 1 from app_records as ar where ar.zone_name = z.name);
  EOQ

  param "target_zones" {
    default = var.target_zones
  }

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "BoundaryProtection"
  })
}
