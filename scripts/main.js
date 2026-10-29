const MODULE_ID = "magic-item-tracker";

const DEFAULT_TARGETS = {
  t1: { common: 6,  uncommon: 4,  rare: 1, veryRare: 0, legendary: 0 },
  t2: { common: 10, uncommon: 17, rare: 6, veryRare: 0, legendary: 0 },
  t3: { common: 0,  uncommon: 0,  rare: 0, veryRare: 0, legendary: 0 },
  t4: { common: 0,  uncommon: 0,  rare: 0, veryRare: 0, legendary: 0 }
};

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "targets", {
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_TARGETS
  });

  game.settings.register(MODULE_ID, "activePlayers", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
  
  game.settings.register(MODULE_ID, "ignoredNames", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
  
  game.settings.register(MODULE_ID, "ignoredPacks", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
  
  game.settings.register(MODULE_ID, "ledger", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
  
  game.settings.register(MODULE_ID, "ignoredItems", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
  
  game.settings.register(MODULE_ID, "frozenSizes", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  console.log(`${MODULE_ID} | settings registered`);
});

const RARITIES = ["common", "uncommon", "rare", "veryRare", "legendary"];
const pendingPurchases = new Set();

function getActiveCharacters() {
  const ids = game.settings.get(MODULE_ID, "activePlayers");
  const pcs = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
  return ids.length ? pcs.filter(a => ids.includes(a.id)) : pcs;
}

function getPartyLevel(actors) {
  if (!actors.length) return 1;
  const total = actors.reduce((sum, a) => sum + (a.system.details.level ?? 1), 0);
  return Math.round(total / actors.length);
}

function getTier(level) {
  if (level <= 4) return "t1";
  if (level <= 10) return "t2";
  if (level <= 16) return "t3";
  return "t4";
}

function getIgnoredNames() {
  const names = game.settings.get(MODULE_ID, "ignoredNames");
  const packNames = game.settings.get(MODULE_ID, "ignoredPacks")
    .flatMap(id => game.packs.get(id)?.index.map(e => e.name) ?? []);
  return new Set([...names, ...packNames].map(n => n.toLowerCase()));
}

const TIERS = ["t1", "t2", "t3", "t4"];

function searchOrder(home) {
  if (!home) return TIERS;
  const h = TIERS.indexOf(home);
  return [home, ...TIERS.slice(0, h).reverse(), ...TIERS.slice(h + 1)];
}

function placeItems(items, targets, currentTier) {
  const grid = {};
  for (const t of TIERS) {
    grid[t] = {};
    for (const r of RARITIES) grid[t][r] = { target: targets[t]?.[r] ?? 0, slots: [], overflow: [] };
  }
  const ordered = [
    ...items.filter(i => i.source === "awarded"),
    ...items.filter(i => i.source === "purchased")
  ];
  for (const item of ordered) {
    const tier = searchOrder(item.tier).find(t => grid[t][item.rarity].slots.length < grid[t][item.rarity].target);
    if (tier) grid[tier][item.rarity].slots.push(item);
    else grid[item.tier ?? currentTier][item.rarity].overflow.push(item);
  }
  return grid;
}

function getLedger() {
  return game.settings.get(MODULE_ID, "ledger");
}

async function addEntry({ name, rarity, kind, quantity = 1, source = "awarded", actor, partyLevel }) {
  const entry = {
    awardId: foundry.utils.randomID(),
    name,
    aliases: [],
    rarity,
    kind,
    quantity,
    source,
    recipientId: actor?.id ?? null,
    recipientName: actor?.name ?? "",
    date: new Date().toISOString(),
    partyLevel,
    history: [],
    status: "active"
  };
  await game.settings.set(MODULE_ID, "ledger", [...getLedger(), entry]);
  return entry;
}

let ledgerQueue = Promise.resolve();
function queueLedger(fn) {
  ledgerQueue = ledgerQueue.then(fn).catch(err => console.error(`${MODULE_ID} |`, err));
  return ledgerQueue;
}

async function recordTransfer(awardId, actor) {
  const ledger = foundry.utils.deepClone(getLedger());
  const entry = ledger.find(e => e.awardId === awardId);
  if (!entry || entry.recipientId === actor.id) return;
  entry.history.push({ fromName: entry.recipientName, toName: actor.name, date: new Date().toISOString() });
  entry.recipientId = actor.id;
  entry.recipientName = actor.name;
  await game.settings.set(MODULE_ID, "ledger", ledger);
}

function ledgerItems() {
  return getLedger()
    .filter(e => e.status === "active")
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap(e => Array.from({ length: e.quantity ?? 1 }, () => ({
      name: e.name,
      rarity: e.rarity,
      kind: e.kind,
      source: e.source,
      recipient: e.recipientName,
      tier: e.partyLevel ? getTier(e.partyLevel) : undefined
    })));
}

const TIER_LABELS = { t1: "Levels 1–4", t2: "Levels 5–10", t3: "Levels 11–16", t4: "Levels 17–20" };
const RARITY_LABELS = { common: "Common", uncommon: "Uncommon", rare: "Rare", veryRare: "Very rare", legendary: "Legendary" };

function dot(item) {
  if (!item) return `<span class="mit-dot mit-empty"></span>`;
  const tip = Handlebars.escapeExpression(`${item.name} — ${item.recipient}`);
  return `<span class="mit-dot mit-${item.source} mit-${item.kind}" data-tooltip="${tip}"></span>`;
}

function renderGrid(grid, currentTier) {
  return TIERS.map(t => {
    const rows = RARITIES
      .filter(r => grid[t][r].target || grid[t][r].slots.length || grid[t][r].overflow.length)
      .map(r => {
        const c = grid[t][r];
        const dots = [...c.slots.map(dot), ...Array(Math.max(0, c.target - c.slots.length)).fill(dot(null))];
        if (c.overflow.length) dots.push(`<span class="mit-divider"></span>`, ...c.overflow.map(dot));
        const placed = c.slots.length + c.overflow.length;
        return `<div class="mit-row"><span>${RARITY_LABELS[r]}</span><div class="mit-dots">${dots.join("")}</div>
          <span class="mit-count ${placed > c.target ? "mit-over" : ""}">${placed} / ${c.target}</span></div>`;
      }).join("");
    const badge = t === currentTier ? `<span class="mit-badge">Current</span>` : "";
    return `<section class="mit-tier"><h3>${TIER_LABELS[t]} ${badge}</h3>${rows || `<p class="mit-none">No targets set</p>`}</section>`;
  }).join("");
}

function renderLedger(entries) {
  const esc = Handlebars.escapeExpression;
  const rows = [...entries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(e => `<tr>
      <td>${esc(e.name)}${e.quantity > 1 ? ` ×${e.quantity}` : ""}</td>
      <td>${RARITY_LABELS[e.rarity]}</td><td>${e.kind}</td><td>${e.source}</td>
      <td>${esc(e.recipientName)}</td><td>${e.date.slice(0, 10)}</td>
      <td><a data-action="editEntry" data-award-id="${e.awardId}" data-tooltip="Edit entry"><i class="fa-solid fa-pen"></i></a>
        <a data-action="deleteEntry" data-award-id="${e.awardId}" data-tooltip="Delete entry"><i class="fa-solid fa-trash"></i></a></td>
    </tr>`).join("");
  return `<h3>Ledger (${entries.length})
      <a data-action="addEntry" data-tooltip="Add entry"><i class="fa-solid fa-plus"></i></a>
      <a data-action="exportLedger" data-tooltip="Export ledger"><i class="fa-solid fa-file-export"></i></a>
      <a data-action="importLedger" data-tooltip="Import ledger"><i class="fa-solid fa-file-import"></i></a></h3>
    <table class="mit-ledger">
      <thead><tr><th>Item</th><th>Rarity</th><th>Kind</th><th>Source</th><th>Recipient</th><th>Date</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function entryDialog(title, e = {}) {
  const esc = Handlebars.escapeExpression;
  const opts = (vals, cur, labels = {}) =>
    vals.map(v => `<option value="${v}" ${v === cur ? "selected" : ""}>${labels[v] ?? v}</option>`).join("");
  const pcs = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
  const content = `
    <div class="form-group"><label>Name</label><input name="name" type="text" value="${esc(e.name ?? "")}"></div>
    <div class="form-group"><label>Rarity</label><select name="rarity">${opts(RARITIES, e.rarity, RARITY_LABELS)}</select></div>
    <div class="form-group"><label>Kind</label><select name="kind">${opts(["permanent", "consumable"], e.kind)}</select></div>
    <div class="form-group"><label>Quantity</label><input name="quantity" type="number" min="1" value="${e.quantity ?? 1}"></div>
    <div class="form-group"><label>Source</label><select name="source">${opts(["awarded", "purchased"], e.source)}</select></div>
    <div class="form-group"><label>Recipient</label><select name="recipientId">${pcs.map(a =>
      `<option value="${a.id}" ${a.id === e.recipientId ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div>
    <div class="form-group"><label>Party level</label><input name="partyLevel" type="number" min="1" max="20" value="${e.partyLevel ?? ""}" placeholder="none"></div>`;
  return foundry.applications.api.DialogV2.prompt({
    window: { title },
    content,
    rejectClose: false,
    ok: {
      label: "Save",
      callback: (event, button) => {
        const v = n => button.form.elements.namedItem(n).value;
        return {
          name: v("name").trim(), rarity: v("rarity"), kind: v("kind"),
          quantity: Math.max(1, Number(v("quantity")) || 1), source: v("source"),
          recipientId: v("recipientId"), partyLevel: v("partyLevel") ? Number(v("partyLevel")) : null
        };
      }
    }
  });
}

function exportLedger() {
  const stamp = new Date().toISOString().slice(0, 10);
  foundry.utils.saveDataToFile(JSON.stringify(getLedger(), null, 2), "application/json", `magic-item-ledger-${stamp}.json`);
}

async function importLedger() {
  const file = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Import ledger" },
    content: `<p>This replaces the entire current ledger.</p><input name="file" type="file" accept=".json">`,
    rejectClose: false,
    ok: { label: "Import", callback: (event, button) => button.form.elements.namedItem("file").files[0] }
  });
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await foundry.utils.readTextFromFile(file));
  } catch {
    return ui.notifications.error("That file isn't valid JSON.");
  }
  if (!Array.isArray(data) || !data.every(e => e.awardId && e.name && RARITIES.includes(e.rarity))) {
    return ui.notifications.error("That file doesn't look like a Magic Item Tracker ledger.");
  }
  await queueLedger(() => game.settings.set(MODULE_ID, "ledger", data));
  ui.notifications.info(`Imported ${data.length} ledger entries.`);
}

class TrackerApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "magic-item-tracker-app",
    window: { title: "Magic Item Tracker", resizable: true },
    position: { width: 680, height: 700 },
    actions: {
      deleteEntry: TrackerApp.onDeleteEntry, editEntry: TrackerApp.onEditEntry, addEntry: TrackerApp.onAddEntry,
      exportLedger, importLedger,
      reviewAward, reviewPurchase, reviewLink, reviewIgnore, reviewDismiss, reviewRecheck, openSettings, reviewAwardAll
    }
  };

  async _renderHTML(context, options) {
    const actors = getActiveCharacters();
    const level = getPartyLevel(actors);
    const tier = getTier(level);
    const grid = placeItems(ledgerItems(), scaledTargets(tier, actors.length), tier);
    return `<p class="mit-header">Party level ${level} · ${actors.length} active players
      <a data-action="openSettings" data-tooltip="Settings"><i class="fa-solid fa-gear"></i></a></p>
      ${renderReview(reconcileState())}${renderGrid(grid, tier)}${renderLedger(getLedger())}`;
  }

  _replaceHTML(result, content, options) {
    content.innerHTML = result;
  }

  static async onDeleteEntry(event, target) {
    const awardId = target.dataset.awardId;
    const entry = getLedger().find(e => e.awardId === awardId);
    if (!entry) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete ledger entry" },
      content: `<p>Delete <strong>${Handlebars.escapeExpression(entry.name)}</strong> from the ledger?</p>`
    });
    if (!ok) return;
    await queueLedger(async () => {
      await game.settings.set(MODULE_ID, "ledger", getLedger().filter(e => e.awardId !== awardId));
      for (const item of findHolders(awardId)) await item.unsetFlag(MODULE_ID, "awardId");
    });
  }

  static async onAddEntry() {
    const data = await entryDialog("Add ledger entry", { partyLevel: getPartyLevel(getActiveCharacters()) });
    if (!data?.name) return;
    await queueLedger(() => addEntry({ ...data, actor: game.actors.get(data.recipientId) }));
  }

  static async onEditEntry(event, target) {
    const awardId = target.dataset.awardId;
    const entry = getLedger().find(e => e.awardId === awardId);
    if (!entry) return;
    const data = await entryDialog(`Edit ${entry.name}`, entry);
    if (!data?.name) return;
    await queueLedger(async () => {
      const ledger = foundry.utils.deepClone(getLedger());
      const e = ledger.find(x => x.awardId === awardId);
      if (!e) return;
      Object.assign(e, data, { recipientName: game.actors.get(data.recipientId)?.name ?? e.recipientName });
      await game.settings.set(MODULE_ID, "ledger", ledger);
    });
  }
}

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = {
    open: () => {
      if (!game.user.isGM) return ui.notifications.warn("Magic Item Tracker is GM-only.");
      new TrackerApp().render({ force: true });
    },
    ledger: getLedger
  };
});

function findHolders(awardId, excludeItemId) {
  return game.actors
    .filter(a => a.type === "character" && a.hasPlayerOwner)
    .flatMap(a => a.items.filter(i => i.id !== excludeItemId && i.getFlag(MODULE_ID, "awardId") === awardId));
}

Hooks.on("createItem", (item, options, userId) => {
  if (!game.users.activeGM?.isSelf) return;
  const actor = item.parent;
  if (!(actor instanceof Actor) || actor.type !== "character" || !actor.hasPlayerOwner) return;
  if (!RARITIES.includes(item.system.rarity)) return;
  if (getIgnoredNames().has(item.name.toLowerCase())) return;

  const existing = item.getFlag(MODULE_ID, "awardId");
    if (existing) {
    if (findHolders(existing, item.id).length) return;
    return queueLedger(() => recordTransfer(existing, actor));
  }
  if (foundry.utils.getProperty(item, "flags.ddbimporter.importId")) return;

  const source = pendingPurchases.delete(item.id) ? "purchased" : "awarded";
  queueLedger(async () => {
    const kind = item.type === "consumable" ? "consumable" : "permanent";
    const quantity = kind === "consumable" ? Math.max(1, item.system.quantity ?? 1) : 1;
    const entry = await addEntry({
      name: item.name, rarity: item.system.rarity, kind, quantity, source, actor,
      partyLevel: getPartyLevel(getActiveCharacters())
    });
    await item.setFlag(MODULE_ID, "awardId", entry.awardId);
  });
});

Hooks.on("deleteItem", (item, options, userId) => {
  if (!game.users.activeGM?.isSelf) return;
  const awardId = item.getFlag(MODULE_ID, "awardId");
  if (!awardId) return;
  const holders = findHolders(awardId, item.id);
  if (holders.length === 1) queueLedger(() => recordTransfer(awardId, holders[0].parent));
});

function refreshTracker(setting) {
  if ([`${MODULE_ID}.ledger`, `${MODULE_ID}.targets`, `${MODULE_ID}.ignoredItems`].includes(setting.key)) {
    foundry.applications.instances.get("magic-item-tracker-app")?.render();
  }
}
Hooks.on("createSetting", refreshTracker);
Hooks.on("updateSetting", refreshTracker);

Hooks.on("item-piles-preTradeItems", (sellingActor, sellerUpdates, buyingActor, buyerUpdates) => {
  if (!game.user.isGM) return;
  if (!game.itempiles?.API?.isItemPileMerchant(sellingActor)) return;
  if (buyingActor?.type !== "character" || !buyingActor.hasPlayerOwner) return;

  for (const data of buyerUpdates.itemsToCreate ?? []) pendingPurchases.add(data._id);

  const ignored = getIgnoredNames();
  for (const delta of buyerUpdates.itemDeltas ?? []) {
    const item = buyingActor.items.get(delta.item._id);
    if (!item || delta.quantity <= 0) continue;
    if (!RARITIES.includes(item.system.rarity) || ignored.has(item.name.toLowerCase())) continue;
    queueLedger(() => addEntry({
      name: item.name, rarity: item.system.rarity,
      kind: item.type === "consumable" ? "consumable" : "permanent",
      quantity: delta.quantity, source: "purchased", actor: buyingActor,
      partyLevel: getPartyLevel(getActiveCharacters())
    }));
  }
});

function logStackAward(item, actor, quantity) {
  if (!RARITIES.includes(item.system.rarity) || getIgnoredNames().has(item.name.toLowerCase())) return;
  queueLedger(() => addEntry({
    name: item.name, rarity: item.system.rarity,
    kind: item.type === "consumable" ? "consumable" : "permanent",
    quantity, source: "awarded", actor,
    partyLevel: getPartyLevel(getActiveCharacters())
  }));
}

function isPC(actor) {
  return actor?.type === "character" && actor.hasPlayerOwner;
}

function onPileTransfer(sourceActor, sourceUpdates, targetActor, targetUpdates) {
  if (!game.user.isGM || !isPC(targetActor) || isPC(sourceActor)) return;
  if (game.itempiles?.API?.isItemPileMerchant(sourceActor)) return;
  const loggedNames = new Set(sourceActor.items.filter(i => i.getFlag(MODULE_ID, "awardId")).map(i => i.name));
  for (const delta of targetUpdates.itemDeltas ?? []) {
    const item = targetActor.items.get(delta.item._id);
    if (!item || delta.quantity <= 0 || loggedNames.has(item.name)) continue;
    logStackAward(item, targetActor, delta.quantity);
  }
}
Hooks.on("item-piles-preTransferItems", onPileTransfer);
Hooks.on("item-piles-preTransferAllItems", onPileTransfer);

Hooks.on("preUpdateItem", (item, changes, options) => {
  const qty = foundry.utils.getProperty(changes, "system.quantity");
  if (qty !== undefined) options.mitQtyDelta = qty - (item.system.quantity ?? 0);
});

Hooks.on("updateItem", (item, changes, options) => {
  if (!game.users.activeGM?.isSelf) return;
  if (!options.dnd5e || !(options.mitQtyDelta > 0)) return;
  if (!isPC(item.parent)) return;
  logStackAward(item, item.parent, options.mitQtyDelta);
});

function reconcileState() {
  const ignored = getIgnoredNames();
  const ignoredItems = new Set(game.settings.get(MODULE_ID, "ignoredItems"));
  const items = game.actors.filter(isPC).flatMap(a =>
    a.items.filter(i => RARITIES.includes(i.system.rarity) && !ignored.has(i.name.toLowerCase())
      && !ignoredItems.has(`${a.id}|${i.name.toLowerCase()}`)));
  const holders = new Map();
  for (const i of items) {
    const id = i.getFlag(MODULE_ID, "awardId");
    if (id) holders.set(id, [...(holders.get(id) ?? []), i]);
  }
  const orphans = getLedger().filter(e => e.status === "active" && !holders.has(e.awardId));
  return {
    unflagged: items.filter(i => !i.getFlag(MODULE_ID, "awardId")),
    orphans,
    missing: orphans.filter(e => e.kind === "permanent" && !e.missingOk),
    duplicates: [...holders.entries()].filter(([, list]) => list.length > 1)
  };
}

async function autoRelink() {
  const { unflagged, orphans } = reconcileState();
  let relinked = 0;
  for (const item of unflagged) {
    const name = item.name.toLowerCase();
    const idx = orphans.findIndex(e =>
      e.recipientId === item.parent.id && e.rarity === item.system.rarity &&
      [e.name, ...(e.aliases ?? [])].some(n => n.toLowerCase() === name));
    if (idx === -1) continue;
    await item.setFlag(MODULE_ID, "awardId", orphans[idx].awardId);
    orphans.splice(idx, 1);
    relinked++;
  }
  const after = reconcileState();
  const review = after.unflagged.length + after.missing.length + after.duplicates.length;
  return { relinked, review };
}

Hooks.on("ddb-importer.characterProcessDataComplete", ({ actor }) => {
  if (!game.user.isGM || !isPC(actor)) return;
  queueLedger(async () => {
    const { relinked, review } = await autoRelink();
    ui.notifications.info(`Magic Item Tracker: re-linked ${relinked} item(s) after import; ${review} need review.`);
  });
});

function renderReview(state) {
  const esc = Handlebars.escapeExpression;
  const rows = [];
  for (const i of state.unflagged) rows.push(`<tr><td>${esc(i.name)}</td><td>${RARITY_LABELS[i.system.rarity]}</td>
    <td>${esc(i.parent.name)}</td><td>Not in ledger</td><td>
    <a data-action="reviewAward" data-uuid="${i.uuid}" data-tooltip="Log as award"><i class="fa-solid fa-gift"></i></a>
    <a data-action="reviewPurchase" data-uuid="${i.uuid}" data-tooltip="Log as purchase"><i class="fa-solid fa-coins"></i></a>
    <a data-action="reviewLink" data-uuid="${i.uuid}" data-tooltip="Link to existing entry"><i class="fa-solid fa-link"></i></a>
    <a data-action="reviewIgnore" data-uuid="${i.uuid}" data-tooltip="Ignore"><i class="fa-solid fa-eye-slash"></i></a></td></tr>`);
  for (const e of state.missing) rows.push(`<tr><td>${esc(e.name)}</td><td>${RARITY_LABELS[e.rarity]}</td>
    <td>${esc(e.recipientName)}</td><td>Missing from sheets</td><td>
    <a data-action="reviewDismiss" data-award-id="${e.awardId}" data-tooltip="Keep counting it"><i class="fa-solid fa-check"></i></a>
    <a data-action="deleteEntry" data-award-id="${e.awardId}" data-tooltip="Delete entry"><i class="fa-solid fa-trash"></i></a></td></tr>`);
  for (const [, list] of state.duplicates) for (const i of list.slice(1)) rows.push(`<tr><td>${esc(i.name)}</td>
    <td>${RARITY_LABELS[i.system.rarity]}</td><td>${esc(i.parent.name)}</td><td>Copy of another PC's item</td><td>
    <a data-action="reviewAward" data-uuid="${i.uuid}" data-tooltip="Count as a new award"><i class="fa-solid fa-gift"></i></a></td></tr>`);
  const body = rows.length
    ? `<table class="mit-ledger"><thead><tr><th>Item</th><th>Rarity</th><th>PC</th><th>Issue</th><th></th></tr></thead>
       <tbody>${rows.join("")}</tbody></table>`
    : `<p class="mit-none">Sheets match the ledger.</p>`;
  const awardAll = state.unflagged.length
    ? `<a data-action="reviewAwardAll" data-tooltip="Log all as awards"><i class="fa-solid fa-gifts"></i></a>` : "";
  return `<h3>Needs review (${rows.length}) <a data-action="reviewRecheck" data-tooltip="Re-check sheets"><i class="fa-solid fa-rotate"></i></a> ${awardAll}</h3>${body}`;
}

async function logReviewItem(uuid, source) {
  const item = fromUuidSync(uuid);
  if (!item) return;
  await queueLedger(async () => {
    await item.unsetFlag(MODULE_ID, "awardId");
    const kind = item.type === "consumable" ? "consumable" : "permanent";
    const quantity = kind === "consumable" ? Math.max(1, item.system.quantity ?? 1) : 1;
    const entry = await addEntry({
      name: item.name, rarity: item.system.rarity, kind, quantity, source, actor: item.parent,
      partyLevel: getPartyLevel(getActiveCharacters())
    });
    await item.setFlag(MODULE_ID, "awardId", entry.awardId);
  });
}

async function reviewAward(event, target) {
  await logReviewItem(target.dataset.uuid, "awarded");
  this.render();
}

async function reviewPurchase(event, target) {
  await logReviewItem(target.dataset.uuid, "purchased");
  this.render();
}

async function reviewIgnore(event, target) {
  const item = fromUuidSync(target.dataset.uuid);
  if (!item) return;
  const list = game.settings.get(MODULE_ID, "ignoredItems");
  await game.settings.set(MODULE_ID, "ignoredItems", [...list, `${item.parent.id}|${item.name.toLowerCase()}`]);
}

async function reviewDismiss(event, target) {
  const awardId = target.dataset.awardId;
  await queueLedger(async () => {
    const ledger = foundry.utils.deepClone(getLedger());
    const e = ledger.find(x => x.awardId === awardId);
    if (!e) return;
    e.missingOk = true;
    await game.settings.set(MODULE_ID, "ledger", ledger);
  });
}

async function reviewRecheck() {
  await queueLedger(() => autoRelink());
  this.render();
}

async function reviewLink(event, target) {
  const esc = Handlebars.escapeExpression;
  const item = fromUuidSync(target.dataset.uuid);
  if (!item) return;
  const { orphans } = reconcileState();
  if (!orphans.length) return ui.notifications.warn("There are no ledger entries without an item to link to.");
  const options = orphans.map(e =>
    `<option value="${e.awardId}">${esc(e.name)} (${RARITY_LABELS[e.rarity]}, ${esc(e.recipientName)})</option>`).join("");
  const awardId = await foundry.applications.api.DialogV2.prompt({
    window: { title: `Link ${item.name}` },
    content: `<div class="form-group"><label>Ledger entry</label><select name="awardId">${options}</select></div>`,
    rejectClose: false,
    ok: { label: "Link", callback: (ev, button) => button.form.elements.namedItem("awardId").value }
  });
  if (!awardId) return;
  await queueLedger(async () => {
    const ledger = foundry.utils.deepClone(getLedger());
    const e = ledger.find(x => x.awardId === awardId);
    if (!e) return;
    const name = item.name.toLowerCase();
    if (e.name.toLowerCase() !== name && !e.aliases.some(a => a.toLowerCase() === name)) e.aliases.push(item.name);
    if (e.recipientId !== item.parent.id) {
      e.history.push({ fromName: e.recipientName, toName: item.parent.name, date: new Date().toISOString() });
      e.recipientId = item.parent.id;
      e.recipientName = item.parent.name;
    }
    e.missingOk = false;
    await game.settings.set(MODULE_ID, "ledger", ledger);
    await item.setFlag(MODULE_ID, "awardId", awardId);
  });
  this.render();
}

async function openSettings() {
  const esc = Handlebars.escapeExpression;
  const targets = game.settings.get(MODULE_ID, "targets");
  const active = new Set(game.settings.get(MODULE_ID, "activePlayers"));
  const ignoredPacks = new Set(game.settings.get(MODULE_ID, "ignoredPacks"));
  const ignoredNames = game.settings.get(MODULE_ID, "ignoredNames");
  const ignoredItems = game.settings.get(MODULE_ID, "ignoredItems");
  const pcs = game.actors.filter(isPC);
  const packs = game.packs.filter(p => p.documentName === "Item");

  const header = `<tr><th></th>${RARITIES.map(r => `<th>${RARITY_LABELS[r]}</th>`).join("")}</tr>`;
  const rows = TIERS.map(t => `<tr><th>${TIER_LABELS[t]}</th>${RARITIES.map(r =>
    `<td><input type="number" min="0" name="${t}.${r}" value="${targets[t]?.[r] ?? 0}" style="width:4em"></td>`).join("")}</tr>`).join("");
  const players = pcs.map(a => `<label style="display:block"><input type="checkbox" name="pc.${a.id}"
    ${active.size === 0 || active.has(a.id) ? "checked" : ""}> ${esc(a.name)}</label>`).join("");
  const packList = packs.map(p => `<label style="display:block"><input type="checkbox" name="pack.${p.collection}"
    ${ignoredPacks.has(p.collection) ? "checked" : ""}> ${esc(p.title)}</label>`).join("");
  const itemList = ignoredItems.map((key, i) => {
    const [actorId, name] = key.split("|");
    return `<label style="display:block"><input type="checkbox" name="ignored.${i}" checked>
      ${esc(name)} (${esc(game.actors.get(actorId)?.name ?? "unknown character")})</label>`;
  }).join("");

  const content = `<p>Targets for a four-player party (DMG 2024 Magic Item Tracker).</p>
    <table>${header}${rows}</table>
    <h4>Active players</h4>${players}
    <h4>Never count items from these compendiums</h4>
    <div style="max-height:10em;overflow-y:auto">${packList}</div>
    <h4>Never count items with these names</h4>
    <textarea name="ignoredNames" rows="4">${esc(ignoredNames.join("\n"))}</textarea>
    <p class="hint">One name per line.</p>
    ${itemList ? `<h4>Ignored from review (untick to restore)</h4>${itemList}` : ""}`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Magic Item Tracker settings" },
    position: { width: 620 },
    content,
    rejectClose: false,
    ok: {
      label: "Save",
      callback: (event, button) => {
        const f = button.form.elements;
        return {
          newTargets: Object.fromEntries(TIERS.map(t => [t, Object.fromEntries(RARITIES.map(r =>
            [r, Math.max(0, Number(f.namedItem(`${t}.${r}`).value) || 0)]))])),
          activeIds: pcs.filter(a => f.namedItem(`pc.${a.id}`).checked).map(a => a.id),
          packIds: packs.filter(p => f.namedItem(`pack.${p.collection}`).checked).map(p => p.collection),
          names: f.namedItem("ignoredNames").value.split("\n").map(n => n.trim()).filter(Boolean),
          keptItems: ignoredItems.filter((key, i) => f.namedItem(`ignored.${i}`).checked)
        };
      }
    }
  });
  if (!result) return;
  await game.settings.set(MODULE_ID, "targets", result.newTargets);
  await game.settings.set(MODULE_ID, "activePlayers", result.activeIds);
  await game.settings.set(MODULE_ID, "ignoredPacks", result.packIds);
  await game.settings.set(MODULE_ID, "ignoredNames", result.names);
  await game.settings.set(MODULE_ID, "ignoredItems", result.keptItems);
  this.render();
}

function scaledTargets(currentTier, activeCount) {
  const base = game.settings.get(MODULE_ID, "targets");
  const frozen = { ...game.settings.get(MODULE_ID, "frozenSizes") };
  let changed = false;
  for (const t of TIERS.slice(0, TIERS.indexOf(currentTier))) {
    if (frozen[t] == null) {
      frozen[t] = activeCount;
      changed = true;
    }
  }
  if (changed && game.user.isGM) game.settings.set(MODULE_ID, "frozenSizes", frozen);
  return Object.fromEntries(TIERS.map(t => [t, Object.fromEntries(RARITIES.map(r =>
    [r, Math.round((base[t]?.[r] ?? 0) * (frozen[t] ?? activeCount) / 4)]))]));
}

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user.isGM || !controls.tokens?.tools) return;
  controls.tokens.tools["magic-item-tracker"] = {
    name: "magic-item-tracker",
    order: 99,
    title: "Magic Item Tracker",
    icon: "fa-solid fa-gem",
    button: true,
    visible: true,
    onChange: (event, active) => {
      if (active === false) return;
      game.modules.get(MODULE_ID).api.open();
    }
  };
});

async function reviewAwardAll() {
  const { unflagged } = reconcileState();
  if (!unflagged.length) return;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Log all as awards" },
    content: `<p>Log all ${unflagged.length} items as awards? They get no party level, so they fill from Levels 1–4 upward. Use this when setting up an existing campaign.</p>`
  });
  if (!ok) return;
  await queueLedger(async () => {
    for (const item of unflagged) {
      const kind = item.type === "consumable" ? "consumable" : "permanent";
      const quantity = kind === "consumable" ? Math.max(1, item.system.quantity ?? 1) : 1;
      const entry = await addEntry({ name: item.name, rarity: item.system.rarity, kind, quantity, actor: item.parent, partyLevel: null });
      await item.setFlag(MODULE_ID, "awardId", entry.awardId);
    }
  });
  this.render();
}
