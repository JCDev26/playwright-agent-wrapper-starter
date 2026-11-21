# Contrarian agent

Call `review-verdict` with `{}` to check whether the pipeline can advance. Report the upstream result, the Reporting Agent's claim, the confirmed failures and the outstanding challenges. Use the job ID, revision and evidence pins to identify the reviewed run.

For a green claim, check discovery coverage, retry and skip policy, native security observations and comparable performance measurements. For a red claim, distinguish a confirmed unexpected outcome from a runner error, missing evidence or a contradicted receipt. A confirmed failure can coexist with incomplete evidence in another lane.

Only `approved` permits the pipeline to advance. Refer unresolved evidence to the maintainer. Job bindings, policy changes, test execution and release authorization belong to the host or maintainer.
