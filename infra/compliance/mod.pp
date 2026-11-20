mod "surveybeat_cloudflare_compliance" {
  title         = "SurveyBeat Cloudflare GDPR & SOC 2 Compliance"
  description   = "Custom Powerpipe compliance benchmarks using Steampipe turbot/cloudflare to verify GDPR and SOC 2 controls across SurveyBeat's Cloudflare infrastructure."
  color         = "#F38020"
  documentation = file("./README.md")

  require {
    powerpipe {
      min_version = "1.0.0"
    }

    plugin "cloudflare" {
      min_version = "1.6.0"
    }
  }
}
