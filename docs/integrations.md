# Integrations

## Google

Google OAuth is implemented for staff setup. After authorization, the owner selects the matching Search Console and GA4 resources for a client and saves the mapping. Reports use those mappings only when the provider returns usable metrics.

Google Business Profile discovery may remain unavailable while Google reviews API access/quota approval. The UI must say that clearly and must not attach another business's location to the selected client.

## Other providers

PageSpeed, Cloudflare, review sources, Square, Mailchimp, and AI features are intentionally represented as setup/not-connected states until their provider credentials, scopes, and backend contracts are implemented. Do not label these as live connections.

## Production checklist

- Verify the intended client is selected before OAuth.
- Verify the returned Google account owns or manages each chosen property.
- Save one mapping per client and confirm the success message.
- Test a connected report and a disconnected report.
- Keep provider secrets in Cloudflare, never in the browser.
