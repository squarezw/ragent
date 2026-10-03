# Vendored dependencies

## ragent-oss 0.1.0

Recovered on 2026-10-03 from the existing frontend pnpm installation after the npm package was unpublished. The seven original package files are preserved byte for byte; their SHA-256 checksums and source path are recorded in `ragent-oss.provenance.json`. This is the last locally installed client SDK, not a claim of the latest upstream source or the OSS server implementation. The recovered package contains no license declaration or license file; no additional license is assigned here.

The frontend uses `file:./vendor/ragent-oss` and keeps its existing package imports and Next.js `transpilePackages` entry. Copy this directory into the Docker builder before `pnpm install`. With the pinned pnpm file dependency, the package is injected into `node_modules`, so the runner copies it with the existing `node_modules` layer. The SDK still communicates with the configured OSS gateway.
