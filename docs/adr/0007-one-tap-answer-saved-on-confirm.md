# A one-tap rating link only preselects; the answer is saved when the member confirms it

SPEC §5.1 said each rating link in an email "records the answer". Email security scanners (Microsoft Defender runs headless Chrome) fetch every link, so recording on GET would count scanners as voters. Some scanners can also produce trusted events, so saving on any interaction would still be unsafe. A rating link (`/a#t=<token>&v=<1–5>`) therefore opens the answer page with that value preselected and writes nothing. The answer is saved only when the member taps "Save and continue", which sits directly under the anonymity statement, or changes the value. A member who taps in the email and leaves without touching the page loses that answer. We accept that loss as the price of never counting a scanner.

## Consequences

- The token exchange that loads the page has no side effects, so R1 has no open tracking at all.
- The anonymity statement is always read before the first Answer is stored.
- One-tap needs a rating Question first in the Pulse. Otherwise the email offers only "Open check-in".
