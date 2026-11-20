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
      cloudflare_zone;
  EOQ

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
    with caa as (
      select
        zone_id,
        count(*) as caa_count
      from
        cloudflare_dns_record
      where
        type = 'CAA'
      group by
        zone_id
    )
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
      left join caa as c
        on c.zone_id = z.id;
  EOQ

  tags = merge(local.common_tags, {
    soc2     = "true"
    category = "DNSIntegrity"
  })
}

control "dns_email_auth_records" {
  title       = "Cloudflare zones should publish SPF and DMARC DNS records"
  description = "GDPR Art. 32 and SOC 2 CC6.6: protects SurveyBeat invitation and email-code sign-in flows from domain spoofing."
  severity    = "high"

  sql = <<-EOQ
    with txt as (
      select
        zone_id,
        bool_or(name = zone_name and content ilike 'v=spf1%') as has_root_spf,
        bool_or(name like '_dmarc.%' and content ilike 'v=DMARC1%') as has_root_dmarc,
        bool_or(name like 'notify.%' and content ilike 'v=spf1%') as has_notify_spf,
        bool_or(name like '_dmarc.notify.%' and content ilike 'v=DMARC1%') as has_notify_dmarc
      from
        cloudflare_dns_record
      where
        type = 'TXT'
      group by
        zone_id
    )
    select
      z.id as resource,
      case
        when coalesce(t.has_root_spf, false) and coalesce(t.has_root_dmarc, false) then 'ok'
        else 'alarm'
      end as status,
      z.name
        || ' root SPF=' || coalesce(t.has_root_spf::text, 'false')
        || ', root DMARC=' || coalesce(t.has_root_dmarc::text, 'false')
        || ', notify SPF=' || coalesce(t.has_notify_spf::text, 'false')
        || ', notify DMARC=' || coalesce(t.has_notify_dmarc::text, 'false')
        || '.' as reason
    from
      cloudflare_zone as z
      left join txt as t
        on t.zone_id = z.id;
  EOQ

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
    with app_records as (
      select
        id,
        zone_name,
        name,
        type,
        proxied,
        proxiable
      from
        cloudflare_dns_record
      where
        type in ('A', 'AAAA', 'CNAME')
        and proxiable is true
        and (
          name = zone_name
          or name like 'www.%'
          or name like 'app.%'
          or name like 'dashboard.%'
          or name like 'submit.%'
          or name like 'staging.%'
        )
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
      cloudflare_zone as z
    where
      not exists (select 1 from app_records);
  EOQ

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "BoundaryProtection"
  })
}
