# OMP Restart Recovery Design

## Goal

Keep OMP managed-provider state across a full `ctx stop`/`ctx start` cycle so the local dynamic gateway is automatically recoverable without changing the explicit `ctx omp stop` behavior.

## Design

The OMP gateway stop operation gains an opt-in `preserveManagedMode` flag. The default remains the existing explicit-stop behavior: drain, hand off to one direct channel, remove managed providers, and delete the managed-mode marker. The PM2 daemon process uses `preserveManagedMode: true` during process exit: drain and stop the local gateway, but leave the managed marker and `ctx-*` provider configuration intact. Foreground `ctx ui` shutdown keeps the existing explicit handoff behavior. On the next daemon boot, the existing marker-based auto-restore starts the gateway and re-syncs providers.

PM2 receives a five-second `kill_timeout` so the daemon shutdown has enough time to complete while active streaming requests are being drained.

## Invariants

- `ctx omp stop` still restores one direct OMP channel.
- `ctx stop` does not delete the OMP managed-mode marker.
- The persisted gateway secret remains unchanged across restart.
- Failed explicit handoff still leaves managed mode active and resumes log observation.

## Verification

Unit tests cover preserved shutdown state, existing explicit-stop handoff, and the PM2 kill timeout. The focused OMP and daemon suites plus a live service status/start smoke check verify the behavior.
