# Verify a release's Playwright evidence

Download `playwright-evidence.json` from the published release. It identifies the repository, tag, commit, main CI run and attempt, Contrarian job, and SHA-256 of each reviewed file. The manifest also records GitHub's IDs and archive digests for the two source artifacts. The release workflow signs the manifest using GitHub artifact attestations. [Release workflow](../.github/workflows/release-evidence.yml) · [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)

## Verify the signature and source

In Bash, set the repository and the published tag you intend to verify. Use a current authenticated GitHub CLI and `jq`. The source commit comes from the release tag independently of the downloaded manifest.

```bash
REPO=JCDev26/playwright-agent-wrapper-starter
TAG=v1.0.0
REF="refs/tags/$TAG"
ENCODED_REF=$(jq -rn --arg ref "$REF" '$ref | @uri')
SHA=$(gh api "repos/$REPO/commits/$ENCODED_REF" --jq .sha)
gh release download "$TAG" -R "$REPO" --pattern playwright-evidence.json --dir evidence
gh attestation verify evidence/playwright-evidence.json -R "$REPO" \
  --signer-workflow "$REPO/.github/workflows/release-evidence.yml" \
  --source-ref "$REF" --source-digest "$SHA" --deny-self-hosted-runners
jq -e --arg repo "$REPO" --arg tag "$TAG" --arg sha "$SHA" \
  '.repository == $repo and .release.tag == $tag and .revision == $sha and .verdict == "approved"' \
  evidence/playwright-evidence.json
```

The verifier checks the file digest, the signing workflow, the expected source revision and the GitHub-hosted runner identity. Use a separately recorded expected commit when auditing an older release. [GitHub CLI verification options](https://cli.github.com/manual/gh_attestation_verify)

## Check the original reports

While the source CI artifacts are retained, download the two named artifacts into the same directory and check each recorded digest. The current CI workflow keeps these artifacts for seven days. Archive them before expiration when later audits require the raw reports.

```bash
MANIFEST=evidence/playwright-evidence.json
RUN=$(jq -er '.ci.runId' "$MANIFEST")
gh run download "$RUN" -R "$REPO" --name "$(jq -er '.artifacts.verdict.name' "$MANIFEST")" --dir evidence/reports
gh run download "$RUN" -R "$REPO" --name "$(jq -er '.artifacts.inputs.name' "$MANIFEST")" --dir evidence/reports
jq -r '.files[] | "\(.sha256)  \(.name)"' "$MANIFEST" | (cd evidence/reports && sha256sum --check -)
```

## What triggers publication

A published release, including a published prerelease, starts the workflow. The validator resolves the tag and checks the latest `ci.yml` main push for that exact SHA. It checks that the attempt and its `verify` job succeeded, retrieves that attempt's immutable inputs and verdict, and requires an approved Contrarian receipt. It checks the receipt's pins and the native files before writing the manifest. The performance section identifies either the accepted main commit and its CI run or an explicit first enrollment. A changed tag, failed check, incomplete rerun or expired input stops publication. Re-running all main CI jobs for that SHA produces a fresh evidence set.

The validator has read access. A separate signing job has the OIDC and attestation permissions, and a third job can attach the verified bytes to the triggering release. Reruns accept an identical asset. A different existing asset causes the publication step to fail. The read-only job also retains the exact subject as a workflow artifact named `release-evidence-<run-id>-<attempt>`.

This workflow attaches a new asset to a mutable published release. GitHub freezes an immutable release's assets at publication. That setting requires a separate prepublication process to prepare and attach the identical manifest to the draft. Without a preattached asset, the signing job still attests the downloadable workflow artifact and the publication job fails. To verify those signed bytes, download `release-evidence-<run-id>-<attempt>` from the release workflow and use the same `gh attestation verify` command above. Protect the release tags and signing workflow under your repository's maintainer review process. [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
