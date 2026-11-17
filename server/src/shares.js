export function equalSplit(count, total = 100) {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function rebalanceOffers(offers) {
  const active = offers.filter((offer) => offer.active);
  const pinnedTotal = active
    .filter((offer) => offer.pinned)
    .reduce((sum, offer) => sum + offer.share, 0);
  if (pinnedTotal > 100) throw new RangeError("Закреплённые доли не могут превышать 100%");

  const flexible = active.filter((offer) => !offer.pinned);
  const remainder = 100 - pinnedTotal;
  if (!flexible.length && remainder !== 0) {
    throw new RangeError("Невозможно распределить остаток: открепите один из офферов");
  }
  const shares = equalSplit(flexible.length, remainder);
  flexible.forEach((offer, index) => { offer.share = shares[index]; });
  offers.filter((offer) => !offer.active).forEach((offer) => { offer.share = 0; });
  return offers;
}

export function withNewOffer(existing, newShare) {
  const pinnedTotal = existing
    .filter((offer) => offer.active && offer.pinned)
    .reduce((sum, offer) => sum + offer.share, 0);
  const available = 100 - pinnedTotal;
  if (available < 1) throw new RangeError("Закреплённые офферы уже занимают 100%");
  const desiredShare = newShare == null ? null : Number(newShare);
  if (desiredShare != null && (!Number.isInteger(desiredShare) || desiredShare < 1 || desiredShare > available)) {
    throw new RangeError(`Доля нового оффера должна быть от 1 до ${available}%`);
  }

  const flexible = existing.filter((offer) => offer.active && !offer.pinned);
  if (desiredShare != null && !flexible.length && desiredShare !== available) {
    throw new RangeError("Невозможно оставить остаток без другого незакреплённого оффера");
  }
  const shares = desiredShare == null
    ? equalSplit(flexible.length + 1, available)
    : equalSplit(flexible.length, available - desiredShare);
  const targetShare = desiredShare ?? shares[flexible.length];
  const distributed = desiredShare == null ? shares.slice(0, flexible.length) : shares;
  flexible.forEach((offer, index) => { offer.share = distributed[index]; });
  return targetShare;
}

export function parseGeo(raw) {
  const parts = String(raw || "").split(/[,\s;]+/).map((part) => part.trim().toUpperCase()).filter(Boolean);
  if (!parts.length) throw new RangeError("Укажите хотя бы один гео-код, например: MX,AU,RO");
  const invalid = parts.filter((part) => !/^[A-Z]{2}$/.test(part));
  if (invalid.length) throw new RangeError(`Некорректные гео-коды (нужен ISO-код из 2 букв): ${invalid.join(", ")}`);
  return [...new Set(parts)];
}
