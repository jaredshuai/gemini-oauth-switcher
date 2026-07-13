# RPG Parchment UI Design

## Goal

Add an optional dark-fantasy game skin while keeping the existing interface as the safe default.

## Direction

Use a restrained RPG equipment-screen language: real raster paper texture, engraved brown borders, compact equipment-slot icons, seal-like current-state markers, and durability-style quota tracks. Preserve the existing warm palette, black credential panel, green/amber/red semantics, and dense three-column account workflow.

## Boundaries

- No functional or data-flow changes.
- No large illustrations, ornamental backgrounds, heavy animation, or fantasy terminology.
- No change to account list columns or action placement.
- Texture and decoration must remain low contrast behind small text.
- Existing reduced-motion behavior remains supported.
- The classic skin remains the default for existing and new users.
- Theme switching is immediate, persistent, and does not trigger account or usage operations.

## Theme Model

- `classic`: the current production visual style from `main`.
- `rpg-parchment`: the optional `冒险者手记` skin described below.
- Both themes use the same React structure and interaction behavior.
- The selected theme is stored as non-sensitive application settings.
- Arbitrary CSS or JavaScript theme plugins are not supported.

## Component Treatment

- **Application surface:** replace embedded SVG noise with a project-local raster parchment tile and restrained edge toning.
- **Mode switch:** make the active and secondary tools read as equipped and stowed slots, with firmer engraved frames and a compact swap rune.
- **Credential console:** strengthen the console frame with subtle corner hardware and inner engraving while preserving the simplified status layout.
- **Account vault:** use a ledger-like frame and header, not a generic floating card.
- **Profile rows:** give account icons equipment-slot depth; current account uses a seal and inset selected state instead of a generic side stripe.
- **Quota bars:** render tracks like compact durability meters while retaining current percentage and severity colors.
- **Buttons:** add restrained bevel/inset feedback without changing shape, labels, or hierarchy.

## Success Criteria

- The first viewport reads as a coherent game utility rather than a themed dashboard.
- Text contrast and scan speed remain at least as good as the current UI.
- Gemini and Antigravity layouts remain stable at the existing desktop window size.
- Typecheck, tests, build, and visual smoke checks pass.
- Settings can switch between `经典简洁` and `冒险者手记` without a reload.
