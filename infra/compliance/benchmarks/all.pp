benchmark "all_compliance" {
  title       = "SurveyBeat Cloudflare Compliance (GDPR & SOC 2)"
  description = "Runs both GDPR and SOC 2 compliance benchmarks against SurveyBeat's Cloudflare account, zones, DNS, Workers, Access, and logging configuration."

  children = [
    benchmark.gdpr,
    benchmark.soc2
  ]

  tags = merge(local.common_tags, {
    type = "Benchmark"
  })
}
