# Security Policy

MonoField is a local-first desktop application, but local-first does not mean
that every operation is offline or sandboxed. Project content can leave the
machine when a user invokes a configured model endpoint, CLI agent, MCP server,
connector, media provider, or marketplace. Enterprise operators should review
and approve those integrations before making them available to users.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities, credentials, private project data,
or exploit details in a public issue.

Use the repository host's private security-advisory channel when it is
available. For an internal deployment, report through the security or incident
response channel designated by the organization that operates the deployment.
If neither private channel is available, contact the repository owner without
including sensitive evidence and agree on a secure transfer method first.

Include the affected version and platform, impact, reproduction conditions,
and the smallest sanitized evidence that demonstrates the issue. Maintainers
should acknowledge the report, coordinate remediation and disclosure with the
reporter, and avoid publishing details before affected deployments can update.

## Supported versions

Security fixes target the current development branch and the latest release
approved by the deploying organization. Older builds may not receive fixes.
Enterprise deployments should keep a tested upgrade and rollback procedure and
should not assume that an arbitrary historical build remains supported.

## Enterprise deployment boundary

- Keep document data, credentials, marketplace metadata, audit records, and
  model configuration inside organization-controlled systems when policy
  requires it.
- Use least-privilege identities for desktop clients and separate publisher
  credentials from consumer credentials.
- Restrict model, MCP, connector, and marketplace endpoints to an approved
  allowlist. Treat content returned by those systems as untrusted input.
- Review retention, telemetry, and data-processing terms for every configured
  external service. MonoField cannot extend its local-first guarantees across a
  third-party endpoint.
- Do not place secrets in prompts, plugin manifests, templates, logs, exported
  artifacts, or vulnerability reports.

## Plugins, skills, and templates

Extensions can contain instructions, scripts, tools, MCP integrations, and
templates that influence agent behavior or access local resources. Installing
an extension is therefore a software supply-chain decision, not merely a
content import.

For managed deployments, distribute extensions through an
organization-controlled registry; pin immutable versions and digests; require
approved publishers and cryptographic verification where supported; retain
license, provenance, and software-bill-of-materials records; scan packages
before promotion; and make reviewed releases the default catalog visible to
desktop users. Revoke or quarantine a package when its publisher, dependency,
or signing key is compromised.

## Managed enterprise marketplace

Set `MONOFIELD_PLUGIN_INSTALL_MODE=managed` before starting MonoField to restrict
plugin installation to package names resolved from approved enterprise
catalogs. Configure these comma-separated, administrator-owned settings before
launch:

- `MONOFIELD_MARKETPLACE_ALLOWED_CATALOG_URLS` contains exact HTTPS catalog URLs,
  including their paths and any non-default ports.
- `MONOFIELD_MARKETPLACE_ALLOWED_HOSTS` contains exact artifact hostnames; wildcards,
  ports, credentials, and URL-shaped values are not accepted.
- `MONOFIELD_MARKETPLACE_ALLOWED_LICENSES` contains the license identifiers or
  proprietary labels that the organization has approved.
- `MONOFIELD_MARKETPLACE_AUTH_ENV` contains only the name of the environment variable
  that holds a catalog credential, such as `MONOFIELD_MARKETPLACE_TOKEN_PLATFORM`.
- `MONOFIELD_BUNDLED_PLUGIN_ALLOWLIST` contains the IDs of bundled plugins approved for
  that deployment.

The marketplace record and UI store or display only the credential environment
variable name. They must never receive the token value. Inject the actual token
through the service manager, deployment secret store, or operating-system
credential facility, and do not copy it into the database, catalog manifest,
configuration files, logs, screenshots, or documentation. Empty or invalid
managed allowlists fail closed for the corresponding catalog operation.

Managed mode is application-layer governance, not a hard security boundary. A
person who controls the process environment, application files, or data files
can alter or bypass those controls. For a hard enterprise boundary, run the
daemon under a dedicated least-privilege OS or service identity, protect its
configuration, database, install directories, and secret mappings with ACLs,
and enforce outbound DNS, proxy, firewall, or endpoint rules independently of
the application.

Build marketplace packages from internal source control and promote them
through CI. The promotion gate should validate manifests, pin immutable
versions and digests, scan for malware, embedded secrets, vulnerable
dependencies, and unacceptable licenses, produce an SBOM, verify signatures
and provenance or attestations, and require an independent approval. MonoField
consumes verification evidence recorded for a package; that metadata is not a
substitute for performing cryptographic verification in the registry or CI
pipeline. Preserve an audit trail and support rapid revocation and quarantine.

Keep legacy and third-party catalog entries in a separate quarantine catalog
that is disabled by default and enabled only by an administrator. Before
promotion, require security and license review plus legal review of trademarks,
trade dress, product names, logos, fonts, images, and other content rights. An
open-source code license does not necessarily grant permission to use those
brand assets in an internal product or catalog.

## Scope and assurances

This policy describes reporting and deployment practices. It is not a security
certification, warranty, legal opinion, or claim of compliance with a specific
regulatory framework. The Apache License 2.0 warranty disclaimer remains in
effect. Each deploying organization is responsible for its own threat model,
access controls, vendor review, data classification, and legal review.
