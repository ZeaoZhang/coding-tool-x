<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

Use the `/trellis:start` command when starting a new session to:
- Initialize your developer identity
- Understand current project context
- Read relevant guidelines

Use `@/.trellis/` to learn:
- Development workflow (`workflow.md`)
- Project structure guidelines (`spec/`)
- Developer workspace (`workspace/`)

Keep this managed block so 'trellis update' can refresh the instructions.

<!-- TRELLIS:END -->

## Platform UI reuse rules

- The existing frontend and backend CLI workflow is the complete baseline. Adding a new CLI should require only platform configuration and the necessary Driver adapter; do not reimplement an existing CLI page, component, panel, lifecycle, or API flow.
- DSH and other platform features must reuse existing platform-agnostic UI before adding new components. For channel management, use `BaseChannelPanel`, `createGenericChannelPanel`, `useChannelManager`, and the manifest-driven `/platforms/:platform/channels` API whenever the existing generic form covers the capability.
- Reuse the existing Skills, Plugins, MCP, Prompts, channel, drawer, form, and API infrastructure when the platform contract can be represented by it. Do not create a platform-specific page, drawer, tab set, or duplicate add/edit panel merely to display or manage the same resource.
- Before adding a platform-specific component, search the existing components, composables, API helpers, manifest capability declarations, and driver contracts. Add a new component only when the existing component cannot represent a proven platform-specific requirement, and keep the platform difference in the manifest or driver adapter where possible.
