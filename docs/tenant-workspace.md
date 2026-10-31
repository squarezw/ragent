# Tenant workspace implementation

`WORKSPACE_TENANT_ENABLED=false` is the default. Both Next.js and ragent-service must be compatible, migrated and explicitly enabled before the UI is available. This change does not edit a deployed environment or start/restart a service.

## Identity and requests

- The account tenant, real user, roles and JWT are unchanged. `X-Workspace-Tenant-ID` names the independently validated operation tenant.
- Super administrators explicitly select an active tenant. Ordinary members are fixed to their account tenant; forging another tenant is denied. Missing selection cannot return an all-tenant business list.
- The selected tenant is stored in sessionStorage per actor/tab. The header, request cancellation, response generation checks, remounted views and SWR cache partition follow the operation tenant. Account/role/department changes invalidate the previous context before a new context lookup completes.
- Downloads/iframes may provide `workspace_tenant_id` in the URL because native navigation cannot set custom headers. Header/query disagreement is denied; this value is still checked against the real actor.
- Uploads and streaming replies block switching. Open editors and known dirty inline editors prompt before discarding changes; ordinary tenant selections do not prompt.

## Boundaries

Organization management, including pending-tenant assignment, is the sole all-tenant business management view. Platform configuration has its own super-administrator entry. Personal profile changes use a narrow self-only field whitelist and preserve account semantics.

Shared platform tools/models, published public Skills and public knowledge datasets retain their availability. Platform-maintained resources are marked as platform-provided; cross-tenant public Skills remain usable but read-only. Tenant-owned configuration and binding remain tenant-scoped. Historical binding rows remain visible with safe source-tenant provenance and unavailable placeholders, without disclosing private names or content.

`lib/workspaceRoutePolicy.ts` is the allowlist for enabled-mode Next APIs. Covered proxies pass the selector to the independently validating backend. Direct SQL routes constrain the workspace before pagination/count/export or mutation. Unknown endpoints fail closed with `WORKSPACE_ROUTE_NOT_READY`; adding a route requires a scope review. The accompanying route inventory records Next coverage, not proof of every downstream runtime path.

Public branding, explicit authentication/personal-account endpoints, organization APIs and signed credential/capability integration callbacks are deliberate exceptions. A capability endpoint derives fixed scope from the issued token or upstream credential/resource, never from a caller-selected browser tenant.

## Files and jobs

Knowledge-file reads require current-tenant dataset ownership with existing access, or an explicitly public dataset. The public read exception also applies to tenant administrators, whose old database function otherwise returns early. The exception permits reading/search/preview only; foreign resources cannot be changed or deleted. Chat attachments require structured attachment metadata on a session with fixed `operation_tenant_id`. Generated Skill artifacts use trusted `external_workspace_resources` records written only after upload succeeds. Model-answer text is never accepted as ownership evidence.

Upload receipts in enabled mode bind actor, object key, MIME and operation tenant under a dedicated issuer/audience/purpose. Legacy receipts are not silently upgraded. PDF preview capabilities bind the same operation tenant and revalidate the resource. Office preview/editor integrations retain their resource-bound capability paths.

External process resources are checked against the operation tenant's existing company mapping and node ancestry. Newly created handbook sessions are attributed in `external_workspace_resources`; old sessions without trustworthy attribution are quarantined rather than guessed from the author's current account tenant. The mapping survives account deletion with a nullable creator, without attributing it to another user.

## Deployment prerequisites and remaining restrictions

Apply the reviewed backend `tenant_workspace.sql` and frontend migrations under `deploy/migrations/` in the deployment's own database before enabling the feature. No migration is automatically executed by importing the application. Historical NULL ownership is not backfilled from current account membership.

The fixed observation-service credential requires an explicit `ZD_OBSERVE_TENANT_ID` owner when the feature is enabled; missing configuration returns 503, and another tenant cannot read its data. Existing external process company mappings must also resolve the selected tenant.

The raw `/api/logs/error` filesystem feed has no trustworthy per-line tenant attribution and is deliberately unavailable in enabled mode. It is not allowed to fall back to a global log dump.

## Verification boundaries

Offline tests exercise actor/tenant validation, forged selectors, stale responses, per-operation upload receipts, resource reads, external-job mapping and signed Office callbacks. A complete frontend suite passed before the final small boundary additions; the final focused boundary suite is also green. The three migration files were run twice against an isolated empty schema clone; the business database was not changed.

Tenant selection was inspected with mocked API responses. No real tenant data was migrated and no live backend end-to-end business acceptance, paid model request, upload or external Office/process conversion was performed by these checks. Keep the feature off until the intended environment's cross-tenant and integration acceptance matrix has passed.

Platform branding remains readable through a public-field projection for ordinary users; full settings remain active-super-only. Workspace-mode logo uploads use the separate `/api/system/logo-presign` endpoint and do not require a selected business tenant. Native iframe/image/download URLs carry workspace query context, and workspace API/file responses use private no-store caching.

### Configuration and rollback boundary

Keep frontend and backend flags identical. Frontend-on/backend-off is rejected through the capability check; frontend-off/backend-on is not a complete fail-closed protocol because direct Next PostgreSQL routes still use legacy behavior. Never enable or roll back one side alone. Once workspace-owned data exists, simply switching the flag off is not a complete data rollback. Preserve ownership and audit columns, inventory new private records and retain the pre-activation Skill environment snapshot. The current new backend's disabled-mode environment resolver excludes operation-specific credentials, but old application artifacts still need a data-aware rollback review.

## Unavailable historical bindings during execution

Invalid private cross-tenant bindings are preserved for diagnosis/removal; they are not automatically shared or reassigned. Runtime resolution skips unavailable implicit Skill, tool and knowledge bindings. Only authorized contents, execution definitions and assets may load. A safe count warning is displayed separately from the answer, and the platform prompt instructs the model to disclose missing capabilities rather than fabricate results. The app itself and explicitly requested files, datasets, Skills and sessions remain strictly authorized. Filtering all knowledge bindings to an empty set does not permit a broader automatic search; an explicit empty dataset selection is also fixed.

## Historical knowledge tags

After the workspace schema migration, an operator may explicitly apply
`deploy/migrations/20261031_knowledge_tags_workspace.sql` to migrate legacy tags.
Back up `knowledge_tags`, `knowledge_file_tags` and their sequences first. The
migration preserves tag IDs for unambiguous single-tenant file use; splits
multi-tenant use into independently owned copies; and copies unused presets to
currently active tenants while retaining quarantined NULL originals. It refuses
referenced tags whose file/dataset ownership is unknown. A migration ledger makes
reapplication a no-op, including after new tenants are added. New tenants do not
automatically inherit historical presets. Names are unique within each tenant.
Restoring global uniqueness after tenant-specific tags exist requires an explicit
data rollback, not merely dropping the new indexes.
