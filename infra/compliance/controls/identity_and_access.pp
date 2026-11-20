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
        else 'alarm'
      end as status,
      case
        when two_factor_authentication_enabled is true
          then 'User ' || coalesce(email, id) || ' has 2FA enabled.'
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
      id as resource,
      case
        when status <> 'accepted' then 'alarm'
        when coalesce((user ->> 'two_factor_authentication_enabled')::boolean, false) is false then 'alarm'
        else 'ok'
      end as status,
      coalesce(user_email, id)
        || ' membership status=' || coalesce(status, 'unknown')
        || ', 2FA=' || coalesce(user ->> 'two_factor_authentication_enabled', 'unknown')
        || '.' as reason
    from
      cloudflare_account_member;
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
        expires_on
      from
        cloudflare_api_token
    )
    select
      t.id as resource,
      case
        when t.status <> 'active' then 'skip'
        when t.expires_on is null then 'alarm'
        when t.expires_on <= now() then 'alarm'
        else 'ok'
      end as status,
      case
        when t.status <> 'active' then 'API token ' || t.name || ' is ' || t.status || '.'
        when t.expires_on is null then 'Active API token ' || t.name || ' has no expiration date.'
        when t.expires_on <= now() then 'API token ' || t.name || ' expired at ' || t.expires_on::text || '.'
        else 'Active API token ' || t.name || ' expires on ' || t.expires_on::text || '.'
      end as reason
    from
      tokens as t
    union all
    select
      u.id as resource,
      'info' as status,
      'No user-scoped API tokens visible to current credential (token may lack User:API Tokens:Read or be account-owned).' as reason
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
        condition
      from
        cloudflare_api_token
    )
    select
      t.id as resource,
      case
        when t.status <> 'active' then 'skip'
        when t.condition -> 'request_ip' is not null then 'ok'
        else 'info'
      end as status,
      case
        when t.status <> 'active' then 'API token ' || t.name || ' is ' || t.status || '.'
        when t.condition -> 'request_ip' is not null then 'API token ' || t.name || ' restricts client IPs.'
        else 'API token ' || t.name || ' has no IP address condition configured (expected for dynamic CI runners; restrict if static).'
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
  description = "GDPR Art. 32 and SOC 2 CC6.1: ensures Zero Trust Access applications do not bypass authentication for everyone."
  severity    = "high"

  sql = <<-EOQ
    with policies as (
      select
        id,
        name,
        application_name,
        decision,
        include
      from
        cloudflare_access_policy
    )
    select
      p.id as resource,
      case
        when p.decision in ('allow', 'bypass') and p.include::text ilike '%"everyone"%' then 'alarm'
        else 'ok'
      end as status,
      case
        when p.decision in ('allow', 'bypass') and p.include::text ilike '%"everyone"%'
          then 'Access policy ' || p.name || ' on ' || coalesce(p.application_name, 'application') || ' has decision=' || p.decision || ' for everyone.'
        else 'Access policy ' || p.name || ' (' || p.decision || ') does not allow/bypass everyone.'
      end as reason
    from
      policies as p
    union all
    select
      a.id as resource,
      'ok' as status,
      'No Cloudflare Access policies configured in account ' || a.name || '.' as reason
    from
      cloudflare_account as a
    where
      not exists (select 1 from policies);
  EOQ

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "AccessControl"
  })
}
