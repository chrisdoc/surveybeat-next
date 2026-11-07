/**
 * Stand-in sign-in secrets for the adapter tests that deploy the Main Worker on local workerd.
 * They are bound like the real ones but never reach WorkOS: those tests do not sign in.
 * Import this before `Test.make`.
 */
process.env["WORKOS_API_KEY"] ??= "sk_test_local_adapter_tests";
process.env["WORKOS_CLIENT_ID"] ??= "client_local_adapter_tests";
process.env["ORG_CREATION_ALLOWLIST"] ??= "nobody@example.invalid";
