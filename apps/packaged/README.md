# apps/packaged

Thin packaged Electron runtime entry for MonoField.

This package starts the packaged daemon and web sidecars, registers the
`monofield://` entry protocol, and delegates to the private Desktop workspace
package for the host window. Product logic stays in `apps/daemon`, `apps/web`,
and `apps/desktop`.
