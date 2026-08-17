# Public GPT-5.6 benchmark in neutral Spanish

Archived version: [DOI 10.5281/zenodo.21978662](https://doi.org/10.5281/zenodo.21978662)  
Repository: [chatgptenespanol/gpt-5.6-api-benchmark](https://github.com/chatgptenespanol/gpt-5.6-api-benchmark)

This reproducible evidence package from `chatgpt-gratis.chat` compares
`gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` through the Responses API.
The Spanish `README.md` and `protocol.md` are authoritative. The package
contains 12 synthetic tasks, three repetitions per model, 108 canonical
outputs, deterministic rules, credential-free requests, literal outputs,
usage and latency metadata, derived results, tests, and SHA-256 checksums.

The benchmark measures only the published criteria under the recorded setup
and date. It is independent, is not an official OpenAI evaluation, and does not
establish universal model superiority.

With Node.js 24 or later, `npm test` validates the evaluator and `npm run
evaluate` recalculates the published results without calling the API. Run
`node publication/verify-publication.mjs` to verify the public tree. The
sanitized tree intentionally fails closed if frozen commands are run in place;
materialize an exact verification copy with `node
publication/materialize-frozen-tree.mjs ../gpt56-verification` and run the npm
commands there. Use the same command with `--fresh` and a new target directory
to prepare a clean rerun. One
test-only synthetic email literal was replaced with a reserved-domain value
before release; `PUBLICATION_SANITIZATION.md` records both hashes and confirms
that no request, response, evaluator rule or result changed. See the Spanish
README for safe rerun and licensing instructions.
