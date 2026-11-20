control "submission_worker_no_logpush" {
  title       = "Submission Worker scripts must have Logpush disabled"
  description = "SPEC §5.3 / §7 and GDPR Art. 25 require SurveyBeat's Submission Worker to keep Logpush off so submission requests are never exported to log pipelines."
  severity    = "critical"

  sql = <<-EOQ
    with submission_workers as (
      select
        id,
        account_id,
        logpush
      from
        cloudflare_worker_script
      where
        id ilike $1 || '%'
        and id ilike '%submission%'
    )
    select
      w.id as resource,
      case
        when w.logpush is true then 'alarm'
        else 'ok'
      end as status,
      case
        when w.logpush is true then 'Submission Worker ' || w.id || ' has logpush enabled.'
        else 'Submission Worker ' || w.id || ' has logpush disabled.'
      end as reason
    from
      submission_workers as w
    union all
    select
      a.id as resource,
      'info' as status,
      'No Submission Worker scripts (*submission*) found in account ' || a.name || '.' as reason
    from
      cloudflare_account as a
    where
      not exists (select 1 from submission_workers);
  EOQ

  param "worker_prefix" {
    default = var.worker_prefix
  }

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "WorkerPrivacy"
  })
}

control "submission_worker_no_tail_consumers" {
  title       = "Submission Worker scripts must have no tail consumers attached"
  description = "SPEC §5.3 / §7 and GDPR Art. 25 require SurveyBeat's Submission Worker to attach zero tail consumers, as tail events carry unredacted client IP headers and request metadata."
  severity    = "critical"

  sql = <<-EOQ
    with submission_workers as (
      select
        id,
        account_id,
        tail_consumers
      from
        cloudflare_worker_script
      where
        id ilike $1 || '%'
        and id ilike '%submission%'
    )
    select
      w.id as resource,
      case
        when jsonb_array_length(coalesce(w.tail_consumers, '[]'::jsonb)) > 0 then 'alarm'
        else 'ok'
      end as status,
      case
        when jsonb_array_length(coalesce(w.tail_consumers, '[]'::jsonb)) > 0
          then 'Submission Worker ' || w.id || ' has ' || jsonb_array_length(w.tail_consumers) || ' tail consumer(s) attached.'
        else 'Submission Worker ' || w.id || ' has no tail consumers attached.'
      end as reason
    from
      submission_workers as w
    union all
    select
      a.id as resource,
      'info' as status,
      'No Submission Worker scripts (*submission*) found in account ' || a.name || '.' as reason
    from
      cloudflare_account as a
    where
      not exists (select 1 from submission_workers);
  EOQ

  param "worker_prefix" {
    default = var.worker_prefix
  }

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "WorkerPrivacy"
  })
}

control "logpush_no_unfiltered_submission_pii" {
  title       = "Logpush jobs must not export ClientIP/ClientRequestURI for Submission hosts or workers_trace_events"
  description = "Per docs/research/workers-logging-privacy.md §5 and GDPR Art. 25, enabled HTTP request Logpush jobs must filter out submit.* hosts or omit ClientIP/ClientRequestURI, and workers_trace_events should not capture Submission requests."
  severity    = "high"

  sql = <<-EOQ
    with account_jobs as (
      select
        a.id as scope_id,
        a.name as scope_name,
        j.id as job_id,
        coalesce(j.name, j.id::text) as job_name,
        j.dataset,
        j.enabled,
        coalesce(j.logpull_options, '') as logpull_options,
        coalesce(j.output_options::text, '') as output_options_text
      from
        cloudflare_account as a
        left join lateral (
          select id, name, dataset, enabled, logpull_options, output_options
          from cloudflare_logpush_job
          where account_id = a.id
        ) as j on true
    ),
    zone_jobs as (
      select
        z.id as scope_id,
        z.name as scope_name,
        j.id as job_id,
        coalesce(j.name, j.id::text) as job_name,
        j.dataset,
        j.enabled,
        coalesce(j.logpull_options, '') as logpull_options,
        coalesce(j.output_options::text, '') as output_options_text
      from
        cloudflare_zone as z
        left join lateral (
          select id, name, dataset, enabled, logpull_options, output_options
          from cloudflare_logpush_job
          where zone_id = z.id
        ) as j on true
      where
        '*' = any($1::text[]) or z.name = any($1::text[])
    ),
    all_scopes as (
      select * from account_jobs
      union all
      select * from zone_jobs
    )
    select
      coalesce(job_id::text, scope_id) as resource,
      case
        when job_id is null then 'ok'
        when not enabled then 'ok'
        when dataset = 'workers_trace_events' then 'alarm'
        when dataset = 'http_requests'
          and (logpull_options ilike '%ClientIP%' or logpull_options ilike '%ClientRequestURI%' or output_options_text ilike '%ClientIP%' or output_options_text ilike '%ClientRequestURI%')
          then 'alarm'
        else 'ok'
      end as status,
      case
        when job_id is null then 'No Logpush jobs configured for ' || scope_name || '.'
        when not enabled then 'Logpush job ' || job_name || ' (' || dataset || ') on ' || scope_name || ' is disabled.'
        when dataset = 'workers_trace_events'
          then 'Enabled Logpush job ' || job_name || ' exports workers_trace_events; verify Submission Workers have logpush=false.'
        when dataset = 'http_requests'
          and (logpull_options ilike '%ClientIP%' or logpull_options ilike '%ClientRequestURI%' or output_options_text ilike '%ClientIP%' or output_options_text ilike '%ClientRequestURI%')
          then 'Enabled http_requests Logpush job ' || job_name || ' on ' || scope_name || ' includes ClientIP or ClientRequestURI.'
        else 'Enabled Logpush job ' || job_name || ' (' || dataset || ') on ' || scope_name || ' does not export ClientIP/ClientRequestURI.'
      end as reason
    from
      all_scopes;
  EOQ

  param "target_zones" {
    default = var.target_zones
  }

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "LogPrivacy"
  })
}
