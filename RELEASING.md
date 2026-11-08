# Publishing releases

A version tag drives the whole release. The `release.yml` workflow publishes npm, the GitHub release and the MCP Registry entry from that tag, in that order.

1. Bump the version in the three files that carry it: `package.json`, `server.json` (twice: the server and its npm package) and `PACKAGE_VERSION` in `src/server.ts`. The test suite fails when they disagree.
2. Add a `## X.Y.Z - YYYY-MM-DD` section to `CHANGELOG.md`. The workflow uses it as the release notes and stops when it is missing.
3. Run `npm run catalog` so `server-card.json` matches the new build, update the README counts and the What's new block if tools changed, and merge the change after CI succeeds.
4. Tag the merged commit and push the tag:

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

5. The workflow checks that the tag matches `package.json`, runs the audit, typecheck, build and tests, then:
   - publishes the package to npm with provenance, through npm trusted publishing (no npm token is stored in the repository);
   - creates the GitHub release from the changelog section and marks it Latest;
   - publishes `server.json` to the MCP Registry, authenticated through the `getmcpads.com` DNS key in the `MCP_DNS_PRIVATE_KEY` secret.

Each step skips cleanly when its target already holds the version, so a partial release can be resumed with **Run workflow** and the existing tag.

Before the first release, configure a trusted publisher on npmjs.com for `@getmcpads/snapchat-ads-mcp-server` that points at this repository and `release.yml`, and add the `MCP_DNS_PRIVATE_KEY` secret. The registry reads `mcpName` from the published npm package, which is why npm is published first.

Before tagging, add the release to CHANGELOG.md as `## X.Y.Z - YYYY-MM-DD - Title`, then run `npm run release-history`. The README shows every release from the changelog, and the test suite fails when it falls behind.
