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
        id ilike '%submission%'
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
        id ilike '%submission%'
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
    with jobs as (
      select
        id::text as job_id,
        coalesce(name, id::text) as job_name,
        dataset,
        enabled,
        coalesce(logpull_options, '') as logpull_options,
        coalesce(output_options::text, '') as output_options_text
      from
        cloudflare_logpush_job
    )
    select
      j.job_id as resource,
      case
        when not j.enabled then 'ok'
        when j.dataset = 'workers_trace_events' then 'alarm'
        when j.dataset = 'http_requests'
          and (j.logpull_options ilike '%ClientIP%' or j.logpull_options ilike '%ClientRequestURI%' or j.output_options_text ilike '%ClientIP%' or j.output_options_text ilike '%ClientRequestURI%')
          then 'alarm'
        else 'ok'
      end as status,
      case
        when not j.enabled then 'Logpush job ' || j.job_name || ' (' || j.dataset || ') is disabled.'
        when j.dataset = 'workers_trace_events'
          then 'Enabled Logpush job ' || j.job_name || ' exports workers_trace_events; verify Submission Workers have logpush=false.'
        when j.dataset = 'http_requests'
          and (j.logpull_options ilike '%ClientIP%' or j.logpull_options ilike '%ClientRequestURI%' or j.output_options_text ilike '%ClientIP%' or j.output_options_text ilike '%ClientRequestURI%')
          then 'Enabled http_requests Logpush job ' || j.job_name || ' includes ClientIP or ClientRequestURI; ensure submit.* host is filtered out or fields are omitted.'
        else 'Enabled Logpush job ' || j.job_name || ' (' || j.dataset || ') does not export ClientIP/ClientRequestURI.'
      end as reason
    from
      jobs as j
    union all
    select
      a.id as resource,
      'ok' as status,
      'No Logpush jobs configured in account ' || a.name || '.' as reason
    from
      cloudflare_account as a
    where
      not exists (select 1 from jobs);
  EOQ

  tags = merge(local.common_tags, {
    gdpr     = "true"
    soc2     = "true"
    category = "LogPrivacy"
  })
}
