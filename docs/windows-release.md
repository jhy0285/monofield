# Windows releases

The `release-windows` workflow builds on a native Windows runner, validates the
launcher payload, and runs installation, runtime, update, and cleanup smoke
checks before publishing immutable GitHub release assets.

The Windows job installs NSIS 3.11 and checks `makensis.exe` before packaging;
the hosted runner does not include this compiler. Failed smoke reports and
build timings are retained separately from verified release assets.

Versions must match the checked-out workspace. Use an exact commit in `ref`.
Publishing is limited to `jhy0285/monofield`; the build job has read-only access
and the publish job verifies all SHA-256 checksums before making the release
public.

Signed releases use `signed=true` and the repository's signing certificate
secrets. An unsigned release requires an explicit `allow_unsigned=true` request;
the evidence records `signed=false`, and the public release notes disclose it.
The default does not allow unsigned publishing.

```bash
gh workflow run release-windows.yml --repo jhy0285/monofield --ref main \
  -f ref=<exact-commit> -f release_version=0.11.6 \
  -f signed=false -f allow_unsigned=true -f publish=true
```

The published installer, portable ZIP, launcher payload, `latest.yml`, and
`SHA256SUMS.txt` remain versioned under the release tag. The packaged stable
updater explicitly uses the GitHub latest-release API; publishing a new stable
release updates this discovery feed. Existing 0.11.5 installs already have this
feed configured.

After publishing, verify the actual downloads and hashes, the updater's selected
version, and the download site's version. Update the site's static application
metadata and screenshot captions only when the new installer is available.
