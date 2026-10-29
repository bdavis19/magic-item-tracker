# Magic Item Tracker

A Foundry VTT module for D&D 5e that tracks the magic items your party receives against the targets on the 2024 Dungeon Master's Guide **Magic Item Tracker** sheet, by level range and rarity.

It logs items automatically as they land on player character sheets, keeps awarded and purchased items separate, and shows everything on a dot grid so you can see at a glance where the party stands and what's still owed.

<!-- Add a screenshot here, e.g. docs/tracker.png -->
<!-- ![The tracker window](docs/tracker.png) -->

## Features

- **Automatic logging.** Magic items dropped onto a PC's sheet are logged as awards. Trades between PCs are recorded as transfers, not new awards.
- **Purchases tracked separately.** Items bought from Item Piles merchants are logged as purchases and shown in their own color.
- **Dot grid view.** One row per rarity in each level range (1–4, 5–10, 11–16, 17–20). Awarded items are green, purchased items red, consumables are rings, and open slots are dashed. Anything over target continues past a divider.
- **Spillover.** When a level range is full for a rarity, new items fill open slots in lower ranges first, then higher ones, mirroring how the DMG sheet is meant to be used.
- **Party-size scaling.** Targets scale to the number of active players. Completed level ranges stay frozen at the party size they ended with.
- **D&D Beyond friendly.** After a DDB Importer re-import, logged items are re-linked to their entries automatically.
- **Needs review.** Anything that doesn't match up (items not in the ledger, items missing from sheets, copies on two sheets) is listed with one-click fixes.
- **Full ledger control.** Add, edit, and delete entries by hand, and export or import the ledger as JSON.

## Requirements

- Foundry VTT v14
- D&D 5e system 6.0 or later

### Optional

- [Item Piles](https://foundryvtt.com/packages/item-piles) (with its D&D 5e add-on): merchant purchases and loot pile pickups are logged automatically.
- [DDB Importer](https://foundryvtt.com/packages/ddb-importer): items are re-linked after character re-imports.

The module works without either. Without Item Piles, log purchases by editing an entry's source. Without DDB Importer, nothing changes.

## Installation

In Foundry's **Add-on Modules** tab, click **Install Module** and paste this manifest URL:

```
https://github.com/bdavis19/magic-item-tracker/releases/latest/download/module.json
```

Then enable **Magic Item Tracker** in your world's module settings.

## Getting started

1. **Open the tracker.** As GM, click the gem icon in the Token Controls toolbar.
2. **Check the settings.** Click the gear icon at the top of the tracker. The targets come pre-filled from the 2024 DMG Magic Item Tracker for a four-player party. Tick the characters who are currently playing.
3. **Log what the party already has.** If you're starting mid-campaign, the items already on your PCs' sheets appear under **Needs review** as "Not in ledger." Click the gifts icon in that heading to log them all at once. They're logged with no party level, so they fill the grid from Levels 1–4 upward.
4. **Play.** From here on, magic items are logged as you hand them out.

The official tracker sheet is available free on [D&D Beyond](https://www.dndbeyond.com/sources/dnd/free-rules/tracking-sheets) if you want to compare or adjust the targets.

## How items are logged

| What happens | What the tracker does |
| --- | --- |
| A magic item is dropped onto a PC's sheet | Logged as an award |
| A consumable is dropped onto an existing stack | Logged as an award for the quantity added |
| A PC loots an Item Piles pile | Logged as an award |
| A PC buys from an Item Piles merchant | Logged as a purchase |
| An item moves from one PC to another | Recorded as a transfer, not a new award |
| A DDB Importer re-import recreates a PC's items | Re-linked to the existing entries |

Only items with a rarity of common through legendary are tracked. Artifacts and mundane gear are ignored.

Note that dragging an item from one PC's sheet to another copies it in dnd5e. The transfer is recorded once the original is deleted from the first sheet.

## Needs review

| Issue | Your options |
| --- | --- |
| Not in ledger | Log as award, log as purchase, link to an existing entry, or ignore for that character |
| Missing from sheets (permanent items) | Keep counting it, or delete the entry |
| Copy of another PC's item | Count it as a new award, or delete the copy from the sheet |

Linking saves the item's current name as an alias, so items renamed in D&D Beyond match automatically on the next import. Consumables missing from sheets are treated as used and are never flagged.

## Ignoring items

In the settings screen you can exclude:

- **Whole compendiums**, for homebrew items that shouldn't count (crafting materials, herbs, and so on).
- **Item names**, one per line.
- **Per-character ignores** made from Needs review, which you can restore by unticking them.

## Using with DDB Importer

A re-import deletes and recreates items in the categories ticked in DDB Importer's update options. The tracker re-links them automatically and shows a notification with the results.

If your PCs carry magic items that exist only in Foundry, turn on **Ignore non-DDB items?** in DDB Importer's character import options, or a re-import will remove them.

## Backups

The ledger is stored in your world and included in world backups. You can also export it as JSON from the tracker's ledger heading, which is worth doing before major updates or re-imports.

## Macro use

```js
game.modules.get("magic-item-tracker").api.open();   // open the tracker (GM only)
game.modules.get("magic-item-tracker").api.ledger(); // read the ledger entries
```

## License

[MIT](LICENSE). Target values are from the 2024 Dungeon Master's Guide by Wizards of the Coast. This module is unofficial and not affiliated with Wizards of the Coast.
