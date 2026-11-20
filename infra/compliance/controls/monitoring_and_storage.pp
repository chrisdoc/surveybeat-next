control "account_notification_policy_configured" {
  title       = "Cloudflare account should have at least one enabled notification policy"
  description = "GDPR Art. 33 and SOC 2 CC7.2 require automated alerting for security events, DDoS, SSL/TLS expiration, or service health."
  severity    = "medium"

  sql = <<-EOQ
    with enabled_policies as (
      select
        account_id,
        count(*) as policy_count
      from
        cloudflare_notification_policy
      where
        enabled is true
      group by
        account_id
    )
    select
      a.id as resource,
      case
        when coalesce(p.policy_count, 0) > 0 then 'ok'
        else 'alarm'
      end as status,
      case
        when coalesce(p.policy_count, 0) > 0
          then 'Account ' || a.name || ' has ' || p.policy_count || ' enabled notification policy(ies).'
        else 'Account ' || a.name || ' has no enabled Cloudflare notification policies.'
      end as reason
    from
      cloudflare_account as a
      left join enabled_policies as p
        on p.account_id = a.id;
  EOQ

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "Monitoring"
  })
}

control "audit_log_active" {
  title       = "Cloudflare user audit logs should be readable and active"
  description = "GDPR Art. 33 and SOC 2 CC7.2 / CC8.1 require verifiable audit trails of configuration changes."
  severity    = "medium"

  sql = <<-EOQ
    with recent as (
      select
        count(*) as event_count,
        max("when") as latest_event
      from
        cloudflare_user_audit_log
    )
    select
      a.id as resource,
      case
        when r.event_count > 0 then 'ok'
        else 'info'
      end as status,
      case
        when r.event_count > 0
          then 'Audit log readable for account ' || a.name || ' (' || r.event_count || ' events fetched; latest at ' || r.latest_event::text || ').'
        else 'No audit log events returned for account ' || a.name || '.'
      end as reason
    from
      cloudflare_account as a
      cross join recent as r;
  EOQ

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "AuditLogging"
  })
}
