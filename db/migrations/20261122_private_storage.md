# Private storage version 1

New project data lives under `UNFOLD_DATA_DIR/private-v1` on a configured persistent local volume.
Manifests record a verified owner, asset roles, plan revisions, export artifacts, job references and active leases.
Metadata writes use exclusive project locks, atomic rename and file/directory synchronization.

Existing ownerless `uploads`, `media` and `store` directories remain untouched. They are quarantined from the authenticated APIs, including local demo requests. No account automatically receives them. Re-upload a source through the authenticated upload flow to create a private project. A future operator migration must supply an explicit verified owner mapping and preserve originals; this change does not run an adoption or deletion migration.

The local demo bypass creates projects owned by the fixed local demo identity. It remains disabled in production. Real accounts require configured email auth and encrypted key storage. The storage implementation is ready for a persistent single-host volume; a managed storage deployment has not been configured or verified.

Project deletion rejects active leases. Job cancellation/draining must finish before deletion; the final locked check rejects newly registered jobs. Finished workers call `unregisterJob` so completed references do not permanently block cleanup. Only the project's registered private tree and resource references are removed; unrelated projects and legacy data are retained.

Private media and HTTP Range reads require the owner session. Renderers receive short-lived, exact-file capabilities tied to an active render lease; only hashes are stored, and releasing the lease revokes access. Capability URLs exist only in the transient rendering plan and never in saved plans or review reports.
