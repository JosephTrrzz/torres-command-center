# Torres AI private Worker

This Cloudflare Worker hosts the read-only Torres AI Agent behind a Pages service binding. It has no public `workers.dev` or preview URL. Each organization/thread pair gets an isolated Durable Object; durable state stores replay nonces and request metadata only, never prompts or answers.

The Pages Function computes exact tenant-scoped totals for common operating questions before evidence reaches the model. The Worker treats conversation history as context rather than evidence, requires allowlisted citations, and performs one deterministic repair attempt only when a model response fails the structured-output contract.

Required encrypted secret: `TORRES_AI_INTERNAL_SECRET` (the same random value stored in the Command Center Pages project). Optional non-secret: `AI_GATEWAY_ID`. AI Gateway payload logging must remain disabled.

Local checks:

```sh
npm run check
npm test
npx wrangler deploy --dry-run
```

See `../../docs/deployment.md` for the controlled activation and rotation sequence.
