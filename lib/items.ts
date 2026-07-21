import itemData from "./item-data.json";

const { version, names } = itemData as { version: string; names: Record<string, string> };

export interface ItemInfo {
  id: number;
  name: string;
  iconUrl: string;
}

// Trinkets/consumables that got sold or swapped out still show up as id 0 in
// an empty slot — not a real item, so callers should filter these out.
export function getItemInfo(id: number): ItemInfo | null {
  if (!id) return null;
  const name = names[String(id)];
  if (!name) return null;
  return { id, name, iconUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png` };
}

// Every boots id Data Dragon tags "Boots" (base, upgraded/enchanted like
// Swiftmarch, and their legacy "223xxx" duplicates) — deliberately excludes
// the junk "Healthbar Splash" cosmetic entries that also carry the tag.
const BOOT_IDS = new Set([
  1001, 1111, 2422, 3005, 3006, 3008, 3009, 3010, 3013, 3020, 3047, 3111, 3117,
  3158, 3168, 3170, 3171, 3173, 3174, 3175, 3176,
  223005, 223006, 223008, 223009, 223020, 223047, 223111, 223158,
]);

// The trinket slot: Stealth Ward and its two upgrades, Farsight Alteration
// and Oracle Lens.
const TRINKET_IDS = new Set([3340, 3363, 3364]);

// Control Wards are a stacking consumable (you can hold more than one) — they
// shouldn't eat a separate core slot per copy, so every copy collapses into
// one slot with a count badge instead.
const CONTROL_WARD_ID = 2055;

// Elixirs get consumed mid-fight and are gone in a couple minutes — showing
// one in the final build just steals a slot from a real item, so these are
// dropped entirely rather than displayed.
const ELIXIR_IDS = new Set([2138, 2139, 2140, 2150, 2151, 2152]);

export interface ItemSlot {
  id: number;
  count: number;
}

// Lays a player's final build out into a fixed row of slots: ADCs and
// supports get an extra bonus-item slot (8 total), everyone else gets 7.
// Whatever isn't boots or a trinket fills the leading slots in the order it
// was bought; the trinket always occupies the very last slot and boots
// always occupies the one before it — empty (null) if the player doesn't
// have one, rather than another item sliding in to fill the gap.
export function arrangeItemSlots(items: number[], role: string): (ItemSlot | null)[] {
  const slotCount = role === "bottom" || role === "support" ? 8 : 7;
  const coreSlotCount = slotCount - 2;

  let boots: number | null = null;
  let trinket: number | null = null;
  let controlWards = 0;
  const core: number[] = [];

  for (const id of items) {
    if (ELIXIR_IDS.has(id)) {
      continue;
    } else if (id === CONTROL_WARD_ID) {
      controlWards++;
    } else if (boots === null && BOOT_IDS.has(id)) {
      boots = id;
    } else if (trinket === null && TRINKET_IDS.has(id)) {
      trinket = id;
    } else {
      core.push(id);
    }
  }

  const coreSlots: ItemSlot[] = core.map((id) => ({ id, count: 1 }));
  if (controlWards > 0) coreSlots.push({ id: CONTROL_WARD_ID, count: controlWards });

  const slots: (ItemSlot | null)[] = [];
  for (let i = 0; i < coreSlotCount; i++) slots.push(coreSlots[i] ?? null);
  slots.push(boots ? { id: boots, count: 1 } : null);
  slots.push(trinket ? { id: trinket, count: 1 } : null);
  return slots;
}
