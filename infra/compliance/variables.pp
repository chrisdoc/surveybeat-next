variable "target_zones" {
  type        = list(string)
  description = "Cloudflare zone names to audit. Pass [\"*\"] to audit every zone in the account."
  default     = ["surveybeat.app"]
}

variable "worker_prefix" {
  type        = string
  description = "Prefix used to match SurveyBeat Worker scripts and scoped resources."
  default     = "surveybeat"
}
