# SSLI Recovered Feature Index

This index is reconstructed from migrated references. It restores a feature/spec surface for test gating.

## Areas

- `Build` - source layout, build script, exhibit format, internal-build default.
- `Scaffold` - landing page, app shell, screen navigation, loading-screen handling.
- `AudioPipeline` - note output, engine availability, safety limiter, worklet fallback.
- `ControlSurfaces` - control surface registration and rendering.
- `Localization` - language data and language switch behavior.
- `Settings` - persistence, MIDI screen, project/runtime settings.
- `Ergonomics` - desktop and phone-landscape rendering checks.

## Recovered Process Rule

Every product change must map to a feature ID, an automated test assertion, a passing area test, and a green gated build.
