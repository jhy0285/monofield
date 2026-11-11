# Microsoft Store release

MonoField keeps two Windows distribution paths:

- **Microsoft Store** — preferred after the listing is certified. Microsoft
  signs and hosts the public AppX package and delivers Store updates.
- **Direct EXE** — the latest NSIS installer downloads directly from the
  GitHub Release. This remains useful before Store certification and as a
  fallback, but Windows can warn about the unsigned installer.

## 1. Reserve the product in Partner Center

Create a Windows app submission and reserve **MonoField**. In **Product
identity**, copy these values exactly:

- Package/Identity/Name
- Package/Identity/Publisher
- Publisher display name
- Store ID (used only for the public website link)

The package identity is not interchangeable with the Store ID. The first three
values belong in the AppX manifest; the 12-character Store ID builds the public
`apps.microsoft.com` link after certification.

## 2. Build the Store package

### On GitHub Actions (recommended)

Save the three identity values as repository **variables** (not secrets; they
are printed in the package manifest anyway) under Settings → Secrets and
variables → Actions → Variables:

- `MONOFIELD_WINDOWS_STORE_IDENTITY_NAME` = Package/Identity/Name
- `MONOFIELD_WINDOWS_STORE_PUBLISHER` = Package/Identity/Publisher (`CN=...`)
- `MONOFIELD_WINDOWS_STORE_PUBLISHER_DISPLAY_NAME` = Publisher display name

Then run the `release-windows` workflow with `store_package` turned on. The
`store_package` job runs beside the GitHub Release build, checks the AppX
manifest identity and version, confirms the direct updater feed is absent, and
uploads `monofield-windows-store-<version>-<run>` as a workflow artifact with
the AppX, `SHA256SUMS.txt`, and `store-manifest.json`. It never adds the AppX to
the GitHub Release, and a Store failure does not block publishing the EXE.

Set all three variables or none. With none, the job still builds and checks a
package under a placeholder identity and names the artifact
`...-placeholder-identity`; Partner Center rejects that package, so it only
proves the build works before the account exists.

### Store version numbers

The Store reserves the fourth version part, so the package version is always
`x.y.z.0`. Every `x.y.z-preview.N` build of the same `x.y.z` therefore becomes
the same Store version, and Partner Center accepts each Store version only once
and only when it is higher than the last one. Submit at most one package per
`x.y.z`, and move to a new `x.y.z` before the next Store submission.

### On a Windows PC

Use Node.js 24 and set the identity values only in the current release shell:

```powershell
$env:MONOFIELD_WINDOWS_STORE_IDENTITY_NAME = "<Package/Identity/Name>"
$env:MONOFIELD_WINDOWS_STORE_PUBLISHER = "<Package/Identity/Publisher>"
$env:MONOFIELD_WINDOWS_STORE_PUBLISHER_DISPLAY_NAME = "<Publisher display name>"

pnpm tools-pack win build `
  --to store `
  --portable `
  --app-version 0.11.5 `
  --json
```

The command produces:

```text
.tmp/tools-pack/out/win/namespaces/default/builder/MonoField-default-store.appx
```

The AppX is intentionally unsigned. It is a Partner Center upload artifact,
not a direct-download artifact. Microsoft validates and signs the package that
customers receive from the Store. The Store build omits MonoField's direct
installer update feed so Store updates remain authoritative.

## 3. Validate and submit

Run the Windows App Certification Kit locally when available, then upload the
AppX in Partner Center. The listing text, age-rating answers, the `runFullTrust`
justification and the certification notes are in
[windows-store-listing.md](windows-store-listing.md). Complete the age rating, privacy, support, screenshots,
and listing copy before submission. Certification timing is controlled by
Microsoft and commonly takes several business days; rejected submissions need
another review cycle.

## 4. Turn on the website Store link

After the listing is publicly reachable, place its 12-character Store ID in
`apps/monofield-site/index.html`:

```html
<meta name="monofield-store-product-id" content="9XXXXXXXXXXX" />
```

With a valid ID, the site automatically:

- makes **Microsoft Store에서 받기** the primary CTA;
- keeps **EXE 직접 다운로드** as a secondary fallback;
- points the header download action at the Store listing; and
- shows the Store link in the footer.

With the meta value empty, Store controls stay hidden and the verified GitHub
Release EXE remains the primary download. This prevents a broken Store link
before certification.

## Release checks

- Store identity exactly matches Partner Center.
- Version is higher than the last submitted Store package.
- AppX carries the MonoField M tile assets.
- Store build contains no direct updater URL. A Store install also skips the
  GitHub "new version" notice: the daemon reports `distribution: "store"`
  (`/api/version`, `monofield version --json`) when it runs from
  `WindowsApps`, and Settings → "latest version" opens the Store's
  Downloads and updates page instead of GitHub Releases.
- App starts, opens a working folder, and launches its local sidecars.
- Privacy policy (`https://monofield.vercel.app/privacy`) and open-source
  notices are reachable from the listing.
- Website Store link is enabled only after the listing is public.
