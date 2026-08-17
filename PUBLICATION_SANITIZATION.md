# Public-release sanitization

The benchmark was frozen and executed against the immutable manifest at `benchmark/pre-run-manifest.json` (SHA-256 `130d86eb9b563b8df3dd718b6ce8e1327f5a900e81742e58b3d35cf564c23c76`).

Before the first public release, two copies of one synthetic Gmail-shaped literal in `tests/runner.test.mjs` were replaced with the reserved-domain value `unexpected@example.invalid`. This fixture exists only to verify that an unexpected email is quarantined. The replacement did not affect the runner used for the 108 API calls, prompts, schemas, raw responses, evaluator, results, latency, token accounting or cost.

The original frozen hash and the sanitized publication hash are recorded in `publication/publication-manifest.json`. Verify the published tree with:

```bash
node publication/verify-publication.mjs
```

This disclosure keeps the original pre-run chain intact while avoiding publication of a deliverable-looking address.
