control "account_enforce_twofactor" {
  title       = "Cloudflare accounts must enforce two-factor authentication for all members"
  description = "GDPR Art. 32 and SOC 2 CC6.1 require multi-factor authentication on administrative control-plane access."
  severity    = "critical"

  sql = <<-EOQ
    select
      id as resource,
      case
        when coalesce((settings ->> 'enforce_twofactor')::boolean, false) is true then 'ok'
        else 'alarm'
      end as status,
      case
        when coalesce((settings ->> 'enforce_twofactor')::boolean, false) is true
          then 'Account ' || name || ' enforces two-factor authentication.'
        else 'Account ' || name || ' does not enforce two-factor authentication (settings.enforce_twofactor=' || coalesce(settings ->> 'enforce_twofactor', 'unset') || ').'
      end as reason
    from
      cloudflare_account;
  EOQ

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "AccessControl"
  })
}

control "user_mfa_enabled" {
  title       = "Authenticated Cloudflare user must have two-factor authentication enabled"
  description = "GDPR Art. 32 and SOC 2 CC6.1 require MFA on the Cloudflare user context."
  severity    = "critical"

  sql = <<-EOQ
    select
      id as resource,
      case
        when two_factor_authentication_enabled is true then 'ok'
        when two_factor_authentication_enabled is null then 'info'
        else 'alarm'
      end as status,
      case
        when two_factor_authentication_enabled is true
          then 'User ' || coalesce(email, id) || ' has 2FA enabled.'
        when two_factor_authentication_enabled is null
          then 'User ' || coalesce(email, id) || ' 2FA field omitted by current credential; check account member 2FA control.'
        else 'User ' || coalesce(email, id) || ' does not have 2FA enabled.'
      end as reason
    from
      cloudflare_user;
  EOQ

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "AccessControl"
  })
}

control "account_member_accepted_and_mfa" {
  title       = "Cloudflare account members should be accepted and have 2FA enabled"
  description = "SOC 2 CC6.1 / CC6.2: identifies stale pending invitations and account members lacking 2FA."
  severity    = "high"

  sql = <<-EOQ
    select
      m.id as resource,
      case
        when m.status <> 'accepted' then 'alarm'
        when coalesce((m.user ->> 'two_factor_authentication_enabled')::boolean, false) is false then 'alarm'
        else 'ok'
      end as status,
      coalesce(m.user_email, m.id)
        || ' membership status=' || coalesce(m.status, 'unknown')
        || ', 2FA=' || coalesce(m.user ->> 'two_factor_authentication_enabled', 'unknown')
        || '.' as reason
    from
      cloudflare_account_member as m;
  EOQ

  tags = merge(local.common_tags, {
    soc2     = "true"
    category = "AccessControl"
  })
}

control "api_token_expiration_set" {
  title       = "Active Cloudflare API tokens should have an expiration date"
  description = "GDPR Art. 32 and SOC 2 CC6.1 / CC6.2: non-expiring API tokens increase blast radius of credential exposure."
  severity    = "medium"

  sql = <<-EOQ
    with tokens as (
      select
        id,
        name,
        status,
        case
          when expires_on is null or expires_on < '1970-01-01'::timestamptz then null
          else expires_on
        end as real_expires_on
      from
        cloudflare_api_token
    )
    select
      t.id as resource,
      case
        when t.status <> 'active' then 'skip'
        when t.real_expires_on is null then 'alarm'
        when t.real_expires_on <= now() then 'alarm'
        else 'ok'
      end as status,
      case
        when t.status <> 'active' then 'API token ' || t.name || ' is ' || t.status || '.'
        when t.real_expires_on is null then 'Active API token ' || t.name || ' has no expiration date.'
        when t.real_expires_on <= now() then 'API token ' || t.name || ' expired at ' || t.real_expires_on::text || '.'
        else 'Active API token ' || t.name || ' expires on ' || t.real_expires_on::text || '.'
      end as reason
    from
      tokens as t
    union all
    select
      u.id as resource,
      'info' as status,
      'No user-scoped API tokens visible to current credential.' as reason
    from
      cloudflare_user as u
    where
      not exists (select 1 from tokens);
  EOQ

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "CredentialHygiene"
  })
}

control "api_token_ip_condition" {
  title       = "Active Cloudflare API tokens should document IP allowlist conditions where feasible"
  description = "SOC 2 CC6.1 defense-in-depth: checks whether active API tokens restrict client IP ranges (informational when used by dynamic GitHub-hosted runners)."
  severity    = "low"

  sql = <<-EOQ
    with tokens as (
      select
        id,
        name,
        status,
        condition -> 'request_ip' -> 'in' as ip_in
      from
        cloudflare_api_token
    )
    select
      t.id as resource,
      case
        when t.status <> 'active' then 'skip'
        when jsonb_typeof(t.ip_in) = 'array' and jsonb_array_length(t.ip_in) > 0 then 'ok'
        else 'info'
      end as status,
      case
        when t.status <> 'active' then 'API token ' || t.name || ' is ' || t.status || '.'
        when jsonb_typeof(t.ip_in) = 'array' and jsonb_array_length(t.ip_in) > 0 then 'API token ' || t.name || ' restricts client IPs.'
        else 'API token ' || t.name || ' has no IP allowlist condition (expected for GitHub-hosted runners; restrict if static).'
      end as reason
    from
      tokens as t
    union all
    select
      u.id as resource,
      'info' as status,
      'No user-scoped API tokens visible to current credential.' as reason
    from
      cloudflare_user as u
    where
      not exists (select 1 from tokens);
  EOQ

  tags = merge(local.common_tags, {
    soc2     = "true"
    category = "CredentialHygiene"
  })
}

control "access_policy_no_unrestricted_bypass" {
  title       = "Cloudflare Access policies must not grant unrestricted everyone bypass/allow"
  description = "GDPR Art. 32 and SOC 2 CC6.1: flags Access policies on target zones that bypass authentication or allow everyone with no require rules."
  severity    = "high"

  sql = <<-EOQ
    with scoped_policies as (
      select
        p.id,
        p.name,
        p.application_name,
        a.domain as application_domain,
        p.decision,
        p.include,
        coalesce(p.require, '[]'::jsonb) as require_rules
      from
        cloudflare_access_policy as p
        join cloudflare_access_application as a on a.id = p.application_id
      where
        '*' = any($1::text[])
        or exists (
          select 1
          from unnest($1::text[]) as tz
          where a.domain ilike '%' || tz || '%'
        )
    )
    select
      p.id as resource,
      case
        when p.decision = 'bypass' and p.include::text ilike '%"everyone"%' then 'alarm'
        when p.decision = 'allow'
          and p.include::text ilike '%"everyone"%'
          and jsonb_array_length(p.require_rules) = 0 then 'alarm'
        else 'ok'
      end as status,
      case
        when p.decision = 'bypass' and p.include::text ilike '%"everyone"%'
          then 'Access policy ' || p.name || ' on ' || coalesce(p.application_name, p.application_domain) || ' bypasses authentication for everyone.'
        when p.decision = 'allow'
          and p.include::text ilike '%"everyone"%'
          and jsonb_array_length(p.require_rules) = 0
          then 'Access policy ' || p.name || ' on ' || coalesce(p.application_name, p.application_domain) || ' allows everyone with zero require rules.'
        else 'Access policy ' || p.name || ' (' || p.decision || ') enforces authentication requirements.'
      end as reason
    from
      scoped_policies as p
    union all
    select
      acc.id as resource,
      'ok' as status,
      'No Cloudflare Access policies scoped to target zones in account ' || acc.name || '.' as reason
    from
      cloudflare_account as acc
    where
      not exists (select 1 from scoped_policies);
  EOQ

  param "target_zones" {
    default = var.target_zones
  }

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "AccessControl"
  })
}
