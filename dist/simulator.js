// src/effects.ts
function applyTrainerEffect(state, pi, card, target, discards) {
  const s = clone(state);
  const me = s.players[pi];
  const opp = s.players[pi === 0 ? 1 : 0];
  const name = card.name;
  const text = (card.rules ?? []).join(" ");
  if (name === "Ultra Ball" || text.includes("discard 2 other cards")) {
    const idxs = discards ?? [];
    if (idxs.length >= 2) {
      const sorted = [...idxs].sort((a, b) => b - a);
      for (const i of sorted) {
        const c = me.hand.splice(i, 1)[0];
        if (c) me.discard.push(c);
      }
    }
    const pIdx = me.deck.findIndex((c) => c.supertype === "Pok\xE9mon");
    if (pIdx >= 0) {
      const found = me.deck.splice(pIdx, 1)[0];
      me.hand.push(found);
      me.deck = shuffle(me.deck);
      addLog(s, `\u30CF\u30A4\u30D1\u30FC\u30DC\u30FC\u30EB: ${found.name} \u3092\u30B5\u30FC\u30C1`);
    } else {
      addLog(s, `\u30CF\u30A4\u30D1\u30FC\u30DC\u30FC\u30EB: \u30DD\u30B1\u30E2\u30F3\u304C\u898B\u3064\u304B\u3089\u306A\u3044`);
    }
    return s;
  }
  if (name === "Buddy-Buddy Poffin" || text.includes("70 HP or less")) {
    const targets = me.deck.filter((c) => isBasicPokemon(c) && (c.hp ?? 0) <= 70);
    shuffle(targets);
    const placed = targets.slice(0, 2);
    for (const p of placed) {
      const slot = me.bench.findIndex((b) => b === null);
      if (slot < 0) break;
      const idx = me.deck.findIndex((c) => c.id === p.id);
      if (idx >= 0) {
        const popped = me.deck.splice(idx, 1)[0];
        me.bench[slot] = makeBenchPokemon(popped, s.turn);
        addLog(s, `\u306A\u304B\u3088\u3057\u30DD\u30D5\u30A3\u30F3: ${popped.name} \u3092\u30D9\u30F3\u30C1\u306B`);
      }
    }
    me.deck = shuffle(me.deck);
    return s;
  }
  if (name.startsWith("Boss's Orders") || text.includes("Switch in 1 of your opponent")) {
    const slot = target ?? oppBestTargetSlot(opp.bench);
    if (slot >= 0 && opp.bench[slot] !== null) {
      const tmp = opp.active;
      opp.active = opp.bench[slot];
      if (tmp) opp.bench[slot] = tmp;
      else opp.bench[slot] = null;
      addLog(s, `\u30DC\u30B9\u306E\u6307\u4EE4: ${opp.active.name} \u304C\u30D0\u30C8\u30EB\u5834\u3078`);
    }
    return s;
  }
  if (name === "Iono" || text.includes("Prize cards")) {
    const meCount = me.prizes.length;
    const oppCount = opp.prizes.length;
    me.deck.push(...me.hand);
    me.deck = shuffle(me.deck);
    me.hand = [];
    drawCards(me, meCount, s);
    opp.deck.push(...opp.hand);
    opp.deck = shuffle(opp.deck);
    opp.hand = [];
    drawCards(opp, oppCount, s);
    addLog(s, `\u30CA\u30F3\u30B8\u30E3\u30E2: \u4E21\u8005\u624B\u672D\u30EA\u30BB\u30C3\u30C8\uFF08${meCount}\u679A / ${oppCount}\u679A\uFF09`);
    return s;
  }
  if (name === "Nemona" || text.includes("Draw 3 cards")) {
    drawCards(me, 3, s);
    addLog(s, `\u30A2\u30AB\u30DE\u30C4: 3\u679A\u30C9\u30ED\u30FC`);
    return s;
  }
  if (name === "Ciphermaniac's Codebreaking" || text.includes("top of it in any order")) {
    const found = [];
    for (let i = 0; i < 2 && me.deck.length > 0; i++) {
      const idx = me.deck.length > 1 ? me.deck.findIndex((c) => c.supertype === "Pok\xE9mon") >= 0 ? me.deck.findIndex((c) => c.supertype === "Pok\xE9mon") : 0 : 0;
      found.push(me.deck.splice(idx, 1)[0]);
    }
    me.deck = shuffle(me.deck);
    for (const c of found.reverse()) me.deck.unshift(c);
    addLog(s, `\u6697\u53F7\u30DE\u30CB\u30A2\u306E\u89E3\u8AAD: 2\u679A\u3092\u30C7\u30C3\u30AD\u30C8\u30C3\u30D7\u306B`);
    return s;
  }
  if (name === "Night Stretcher" || text.includes("discard pile into your hand")) {
    const pIdx = me.discard.findIndex((c) => c.supertype === "Pok\xE9mon");
    const eIdx = me.discard.findIndex((c) => c.supertype === "Energy");
    const chosen = pIdx >= 0 ? pIdx : eIdx;
    if (chosen >= 0) {
      const recovered = me.discard.splice(chosen, 1)[0];
      me.hand.push(recovered);
      addLog(s, `\u591C\u306E\u30BF\u30F3\u30AB: ${recovered.name} \u3092\u56DE\u53CE`);
    }
    return s;
  }
  if (name === "Pal Pad" || text.includes("Supporter cards from your discard")) {
    let count = 0;
    for (let i = me.discard.length - 1; i >= 0 && count < 2; i--) {
      const c = me.discard[i];
      if (c.subtypes.includes("Supporter")) {
        me.discard.splice(i, 1);
        me.deck.push(c);
        count++;
      }
    }
    me.deck = shuffle(me.deck);
    addLog(s, `\u30DD\u30B1\u30D1\u30C3\u30C9: \u30B5\u30DD\u30FC\u30C8${count}\u679A\u3092\u30C7\u30C3\u30AD\u306B\u623B\u3059`);
    return s;
  }
  if (name === "Hero's Cape" || text.includes("+100 HP") || text.includes("100 HP")) {
    const pokemon = target === -1 ? me.active : me.bench[target ?? 0];
    if (pokemon && !pokemon.toolCard) {
      pokemon.toolCard = card;
      pokemon.maxHp += 100;
      pokemon.currentHp = Math.min(pokemon.currentHp + 100, pokemon.maxHp);
      addLog(s, `\u30D2\u30FC\u30ED\u30FC\u30DE\u30F3\u30C8: ${pokemon.name} \u306EHP\u304C+100`);
    }
    return s;
  }
  if (name.includes("Energy") && (text.includes("Move") || name.includes("Switch") || name.includes("Transfer") || name.includes("\u3064\u3051\u304B\u3048"))) {
    if (me.active) {
      for (let i = 0; i < me.bench.length; i++) {
        const b = me.bench[i];
        if (b && b.energies.length > 0) {
          const e = b.energies.pop();
          me.active.energies.push(e);
          addLog(s, `\u30A8\u30CD\u30EB\u30AE\u30FC\u3064\u3051\u304B\u3048: ${b.name} \u2192 ${me.active.name} (${e})`);
          break;
        }
      }
    }
    return s;
  }
  if (card.subtypes.includes("Stadium")) {
    if (me.stadium) me.discard.push(me.stadium);
    if (opp.stadium) opp.discard.push(opp.stadium);
    me.stadium = card;
    opp.stadium = card;
    addLog(s, `\u30B9\u30BF\u30B8\u30A2\u30E0: ${card.name}`);
    return s;
  }
  if (name === "Special Red Card" || name.includes("\u30B9\u30DA\u30B7\u30E3\u30EB\u30EC\u30C3\u30C9\u30AB\u30FC\u30C9")) {
    opp.deck.push(...opp.hand);
    opp.deck = shuffle(opp.deck);
    opp.hand = [];
    drawCards(opp, 1, s);
    addLog(s, `Special Red Card: \u76F8\u624B\u306E\u624B\u672D\u30EA\u30BB\u30C3\u30C8(1\u679A\u30C9\u30ED\u30FC)`);
    return s;
  }
  if (name.includes("Lillie's Determination") || name.includes("\u30EA\u30FC\u30EA\u30A8\u306E\u6C7A\u5FC3")) {
    const need = Math.max(0, 8 - me.hand.length);
    drawCards(me, need, s);
    addLog(s, `\u30EA\u30FC\u30EA\u30A8\u306E\u6C7A\u5FC3: ${need}\u679A\u30C9\u30ED\u30FC\uFF08\u624B\u672D${me.hand.length}\u679A\u306B\uFF09`);
    return s;
  }
  if (name === "N's Plan" || name.includes("N\u306E\u7B4B\u66F8\u304D")) {
    if (me.active) {
      let moved = 0;
      for (let i = 0; i < me.bench.length && moved < 2; i++) {
        const b = me.bench[i];
        if (b && b.energies.length > 0) {
          const e = b.energies.pop();
          me.active.energies.push(e);
          addLog(s, `N's Plan: ${b.name} \u2192 ${me.active.name} (${e})`);
          moved++;
        }
      }
      if (moved === 0) addLog(s, `N's Plan: \u79FB\u52D5\u3059\u308B\u30A8\u30CD\u30EB\u30AE\u30FC\u306A\u3057`);
    }
    return s;
  }
  if (name.includes("\u3080\u3057\u3068\u308A") || name.includes("Bug Catching")) {
    const top7 = me.deck.slice(0, 7);
    const rest = me.deck.slice(7);
    const grassCards = top7.filter(
      (c) => c.supertype === "Pok\xE9mon" && c.types.includes("Grass") || c.supertype === "Energy" && (c.name.includes("Grass") || c.types.includes("Grass"))
    );
    const taken = grassCards.slice(0, 2);
    for (const tc of taken) {
      const idx = top7.findIndex((c) => c.id === tc.id);
      top7.splice(idx, 1);
    }
    me.hand.push(...taken);
    me.deck = [...shuffle(top7), ...rest];
    addLog(s, `\u3080\u3057\u3068\u308A\u30BB\u30C3\u30C8: ${taken.length}\u679A\u53D6\u5F97 (${taken.map((c) => c.name).join(", ")})`);
    return s;
  }
  if (name.includes("Unfair Stamp") || name.includes("\u30A2\u30F3\u30D5\u30A7\u30A2\u30B9\u30BF\u30F3\u30D7")) {
    opp.deck.push(...opp.hand);
    opp.deck = shuffle(opp.deck);
    opp.hand = [];
    drawCards(opp, 3, s);
    addLog(s, `\u30A2\u30F3\u30D5\u30A7\u30A2\u30B9\u30BF\u30F3\u30D7: \u76F8\u624B\u306E\u624B\u672D\u30EA\u30BB\u30C3\u30C8(3\u679A\u30C9\u30ED\u30FC)`);
    return s;
  }
  if (name.includes("Terastal Orb") || name.includes("\u30C6\u30E9\u30B9\u30BF\u30EB\u30AA\u30FC\u30D6")) {
    const pokemon = target === -1 ? me.active : me.bench[target ?? 0];
    if (pokemon && !pokemon.toolCard) {
      pokemon.toolCard = card;
      pokemon.maxHp += 30;
      pokemon.currentHp = Math.min(pokemon.currentHp + 30, pokemon.maxHp);
      addLog(s, `\u30C6\u30E9\u30B9\u30BF\u30EB\u30AA\u30FC\u30D6: ${pokemon.name} \u306B\u88C5\u7740`);
    }
    return s;
  }
  addLog(s, `${name}: \u52B9\u679C\u672A\u5B9F\u88C5\u306E\u305F\u3081\u30B9\u30AD\u30C3\u30D7`);
  return s;
}
function applyAttackEffect(state, atkPi, attackText, attackName, damage) {
  const s = state;
  const atk = s.players[atkPi];
  const def = s.players[atkPi === 0 ? 1 : 0];
  if (attackName === "Phantom Dive") {
    let counters = 6;
    const benchTargets = def.bench.filter((b) => b !== null);
    if (benchTargets.length > 0) {
      const perPokemon = Math.floor(counters / benchTargets.length);
      let extra = counters % benchTargets.length;
      for (const b of benchTargets) {
        const dmg = (perPokemon + (extra-- > 0 ? 1 : 0)) * 10;
        dealDamage(b, dmg, s);
        if (b.currentHp <= 0) {
          const prizes = b.isEx ? 2 : 1;
          atk.prizesTaken += prizes;
          const taken = def.prizes.splice(0, prizes);
          atk.hand.push(...taken);
          addLog(s, `${b.name} \u304C\u30D9\u30F3\u30C1\u3067\u304D\u305C\u3064\uFF01 \u30B5\u30A4\u30C9${prizes}\u679A`);
        }
      }
      addLog(s, `Phantom Dive: \u30D9\u30F3\u30C1\u306B${counters}\u30C0\u30E1\u30AB\u30F3\u6563\u5E03`);
    }
    return s;
  }
  if (attackName === "Tenacious Tail") {
    const exCount = countOppEx(def);
    addLog(s, `Tenacious Tail: \u76F8\u624B\u306Eex ${exCount}\u4F53 \u2192 ${exCount * 60}\u30C0\u30E1\u30FC\u30B8`);
    return s;
  }
  if (attackName === "Eon Blade") {
    if (atk.active) {
      atk.active.cantAttackUntilTurn = s.turn + 2;
      addLog(s, `Eon Blade: ${atk.active.name} \u306F\u6B21\u306E\u30BF\u30FC\u30F3\u653B\u6483\u3067\u304D\u306A\u3044`);
    }
    return s;
  }
  if (attackName === "Full Moon Rondo") {
    const myBench = atk.bench.filter((b) => b !== null).length;
    const oppBench = def.bench.filter((b) => b !== null).length;
    const extra = (myBench + oppBench) * 20;
    if (def.active) {
      dealDamage(def.active, extra, s);
      addLog(s, `Full Moon Rondo: \u30D9\u30F3\u30C1\u5408\u8A08${myBench + oppBench}\u4F53 \u2192 +${extra}\u30C0\u30E1\u30FC\u30B8`);
      if (def.active.currentHp <= 0) handleKnockout(s, def, atk, def.active);
    }
    return s;
  }
  if (attackName === "Irritated Outburst") {
    addLog(s, `Irritated Outburst: \u76F8\u624B\u53D6\u5F97\u30B5\u30A4\u30C9${atk.prizesTaken}\u679A \u2192 ${atk.prizesTaken * 60}\u30C0\u30E1\u30FC\u30B8\u5B9F\u969B\u5024`);
    return s;
  }
  if (attackName === "Dizzy Punch") {
    const extra = [Math.random() < 0.5, Math.random() < 0.5].filter(Boolean).length * 90;
    if (def.active) {
      dealDamage(def.active, extra, s);
      addLog(s, `Dizzy Punch: \u30B3\u30A4\u30F3 ${extra / 90}\u56DE\u8868 \u2192 +${extra}\u30C0\u30E1\u30FC\u30B8`);
      if (def.active.currentHp <= 0) handleKnockout(s, def, atk, def.active);
    }
    return s;
  }
  if (attackName === "Myriad Leaf Shower") {
    addLog(s, `Myriad Leaf Shower: \u30EF\u30B6\u52B9\u679C\u767A\u52D5`);
    return s;
  }
  return s;
}
function calcAttackDamage(state, atkPi, attack) {
  const atk = state.players[atkPi];
  const def = state.players[atkPi === 0 ? 1 : 0];
  if (attack.name === "Tenacious Tail") {
    return countOppEx(def) * 60;
  }
  if (attack.name === "Irritated Outburst") {
    return def.prizesTaken * 60;
  }
  if (attack.name === "Dizzy Punch") {
    return 90;
  }
  if (attack.name === "Full Moon Rondo") {
    const myBench = atk.bench.filter((b) => b !== null).length;
    const oppBench = def.bench.filter((b) => b !== null).length;
    return 20 + (myBench + oppBench) * 20;
  }
  if (!attack.damage) return 0;
  const n = parseInt(attack.damage.replace(/[^0-9]/g, ""));
  return isNaN(n) ? 0 : n;
}
function makeBenchPokemon(card, turn) {
  const isEx = card.subtypes.some((s) => ["ex", "EX", "V", "VMAX", "VSTAR"].includes(s));
  return {
    cardId: card.id,
    name: card.name,
    maxHp: card.hp ?? 0,
    currentHp: card.hp ?? 0,
    status: "none",
    energies: [],
    damageCounters: 0,
    isEx,
    evolveBlocked: true,
    // 出したターンは進化不可
    toolCard: null,
    cantAttackUntilTurn: -1
  };
}
function countOppEx(def) {
  let n = def.active?.isEx ? 1 : 0;
  for (const b of def.bench) if (b?.isEx) n++;
  return n;
}
function oppBestTargetSlot(bench) {
  let best = -1, bestHp = -1;
  for (let i = 0; i < bench.length; i++) {
    const b = bench[i];
    if (b && b.currentHp > bestHp) {
      bestHp = b.currentHp;
      best = i;
    }
  }
  return best;
}

// src/game-engine.ts
function createActivePokemon(card) {
  const isEx = card.subtypes.some(
    (s) => s === "ex" || s === "EX" || s === "V" || s === "VMAX" || s === "VSTAR"
  );
  return {
    cardId: card.id,
    name: card.name,
    maxHp: card.hp ?? 0,
    currentHp: card.hp ?? 0,
    status: "none",
    energies: [],
    damageCounters: 0,
    isEx,
    evolveBlocked: true,
    toolCard: null,
    cantAttackUntilTurn: -1
  };
}
function createPlayerState(deck) {
  const shuffled = shuffle([...deck]);
  const prizes = shuffled.splice(0, 6);
  const hand = shuffled.splice(0, 7);
  return {
    deck: shuffled,
    hand,
    bench: [null, null, null, null, null],
    active: null,
    discard: [],
    prizes,
    prizesTaken: 0,
    supporterPlayedThisTurn: false,
    energyAttachedThisTurn: false,
    stadium: null
  };
}
function initGame(deckA, deckB) {
  const p0 = createPlayerState(deckA);
  const p1 = createPlayerState(deckB);
  ensureBasicInHand(p0, deckA);
  ensureBasicInHand(p1, deckB);
  return {
    turn: 1,
    activePlayer: 0,
    phase: "setup",
    players: [p0, p1],
    winner: null,
    firstTurn: true,
    log: []
  };
}
function ensureBasicInHand(player, origDeck) {
  let attempts = 0;
  while (!player.hand.some(isBasicPokemon) && attempts < 10) {
    player.discard.push(...player.hand);
    const full = shuffle([...origDeck]);
    player.prizes = full.splice(0, 6);
    player.hand = full.splice(0, 7);
    player.deck = full;
    attempts++;
  }
}
function startTurn(state) {
  const s = clone(state);
  const p = s.players[s.activePlayer];
  if (!s.firstTurn) {
    drawCards(p, 1, s);
  }
  p.supporterPlayedThisTurn = false;
  p.energyAttachedThisTurn = false;
  if (p.active) p.active.evolveBlocked = false;
  for (const b of p.bench) if (b) b.evolveBlocked = false;
  if (p.active && p.active.cantAttackUntilTurn >= s.turn) {
    addLog(s, `${p.active.name} \u306F\u4ECA\u30BF\u30FC\u30F3\u653B\u6483\u3067\u304D\u306A\u3044\uFF08\u524D\u30BF\u30FC\u30F3\u306E\u52B9\u679C\uFF09`);
  }
  s.phase = "main";
  addLog(s, `--- \u30BF\u30FC\u30F3${s.turn} (\u30D7\u30EC\u30A4\u30E4\u30FC${s.activePlayer}) ---`);
  return s;
}
function endTurn(state) {
  const s = clone(state);
  applyStatusDamage(s);
  applyStatusRecovery(s);
  const winner = checkWinCondition(s);
  if (winner !== null) {
    s.winner = winner;
    s.phase = "end";
    addLog(s, `\u52DD\u8005: \u30D7\u30EC\u30A4\u30E4\u30FC${winner}`);
    return s;
  }
  s.activePlayer = s.activePlayer === 0 ? 1 : 0;
  s.turn++;
  s.firstTurn = false;
  s.phase = "draw";
  return s;
}
function drawCards(player, count, state) {
  for (let i = 0; i < count; i++) {
    if (player.deck.length === 0) return;
    player.hand.push(player.deck.shift());
  }
}
function playBasicToActive(state, handIndex) {
  const s = clone(state);
  const p = s.players[s.activePlayer];
  const card = p.hand[handIndex];
  if (!card || !isBasicPokemon(card)) return s;
  p.hand.splice(handIndex, 1);
  if (p.active === null) {
    p.active = createActivePokemon(card);
    addLog(s, `${card.name} \u3092\u30D0\u30C8\u30EB\u5834\u306B\u51FA\u3057\u305F`);
  } else if (p.bench.some((b) => b === null)) {
    const slot = p.bench.findIndex((b) => b === null);
    p.bench[slot] = makeBenchPokemon(card, s.turn);
    addLog(s, `${card.name} \u3092\u30D9\u30F3\u30C1\u306B\u51FA\u3057\u305F`);
  }
  return s;
}
function evolvePokemon(state, handIndex, targetSlot) {
  const s = clone(state);
  const p = s.players[s.activePlayer];
  const evolCard = p.hand[handIndex];
  if (!evolCard || evolCard.supertype !== "Pok\xE9mon") return s;
  const target = targetSlot === -1 ? p.active : p.bench[targetSlot];
  if (!target) return s;
  if (target.evolveBlocked) {
    addLog(s, `${target.name} \u306F\u4ECA\u30BF\u30FC\u30F3\u9032\u5316\u3067\u304D\u306A\u3044`);
    return s;
  }
  if (s.firstTurn) {
    addLog(s, `\u5148\u884C1\u30BF\u30FC\u30F3\u76EE\u306F\u9032\u5316\u3067\u304D\u306A\u3044`);
    return s;
  }
  const targetCard = getCardData2(s, target.cardId);
  if (evolCard.evolvesFrom !== targetCard?.name) {
    addLog(s, `${evolCard.name} \u306F ${target.name} \u306B\u9032\u5316\u3067\u304D\u306A\u3044`);
    return s;
  }
  const hpDiff = (evolCard.hp ?? 0) - target.maxHp;
  const oldTool = target.toolCard;
  const oldEnergies = target.energies;
  const oldStatus = target.status;
  target.cardId = evolCard.id;
  target.name = evolCard.name;
  target.maxHp = (evolCard.hp ?? 0) + (oldTool ? 100 : 0);
  target.currentHp = Math.min(target.currentHp + Math.max(0, hpDiff), target.maxHp);
  target.isEx = evolCard.subtypes.some((s2) => ["ex", "EX", "V", "VMAX", "VSTAR"].includes(s2));
  target.status = "none";
  target.energies = oldEnergies;
  target.toolCard = oldTool;
  target.evolveBlocked = true;
  target.cantAttackUntilTurn = -1;
  p.hand.splice(handIndex, 1);
  if (targetCard) p.discard.push(targetCard);
  addLog(s, `${target.name} \u306B\u9032\u5316\u3057\u305F\uFF08HP: ${target.currentHp}/${target.maxHp}\uFF09`);
  return s;
}
function attachEnergy(state, handIndex, targetSlot) {
  const s = clone(state);
  const p = s.players[s.activePlayer];
  if (p.energyAttachedThisTurn) {
    addLog(s, "\u30A8\u30CD\u30EB\u30AE\u30FC\u306F\u3059\u3067\u306B\u4ED8\u3051\u305F");
    return s;
  }
  const card = p.hand[handIndex];
  if (!card || card.supertype !== "Energy") return s;
  const target = targetSlot === -1 ? p.active : p.bench[targetSlot];
  if (!target) return s;
  const energyType = inferEnergyType2(card);
  target.energies.push(energyType);
  p.hand.splice(handIndex, 1);
  p.discard.push(card);
  p.energyAttachedThisTurn = true;
  addLog(s, `${target.name} \u306B ${energyType} \u30A8\u30CD\u30EB\u30AE\u30FC\u3092\u3064\u3051\u305F`);
  return s;
}
function playTrainer(state, handIndex, target, discards) {
  const s = clone(state);
  const p = s.players[s.activePlayer];
  const card = p.hand[handIndex];
  if (!card || card.supertype !== "Trainer") return s;
  const isSupporter = card.subtypes.includes("Supporter");
  const isTool = card.subtypes.includes("Pok\xE9mon Tool") || card.subtypes.includes("Tool");
  const isStadium = card.subtypes.includes("Stadium");
  const isItem = !isSupporter && !isTool && !isStadium;
  if (isSupporter && p.supporterPlayedThisTurn) {
    addLog(s, "\u30B5\u30DD\u30FC\u30C8\u306F\u3059\u3067\u306B\u4F7F\u3063\u305F");
    return s;
  }
  p.hand.splice(handIndex, 1);
  if (!isTool && !isStadium) p.discard.push(card);
  const pi = s.activePlayer;
  const after = applyTrainerEffect(s, pi, card, target, discards);
  if (isSupporter) after.players[pi].supporterPlayedThisTurn = true;
  return after;
}
function useAttack(state, attackIndex) {
  const s = clone(state);
  if (s.firstTurn) {
    addLog(s, "\u5148\u884C1\u30BF\u30FC\u30F3\u76EE\u306F\u30EF\u30B6\u3092\u4F7F\u3048\u306A\u3044");
    return s;
  }
  const atkPi = s.activePlayer;
  const defPi = atkPi === 0 ? 1 : 0;
  const atk = s.players[atkPi];
  const def = s.players[defPi];
  if (!atk.active || !def.active) return s;
  const attacker = atk.active;
  const defender = def.active;
  if (attacker.cantAttackUntilTurn >= s.turn) {
    addLog(s, `${attacker.name} \u306F\u653B\u6483\u3067\u304D\u306A\u3044\uFF08\u524D\u30BF\u30FC\u30F3\u306E\u52B9\u679C\uFF09`);
    return s;
  }
  const card = getCardData2(s, attacker.cardId);
  const attack = card?.attacks[attackIndex];
  if (!attack) return s;
  if (!canUseAttack(attacker, attack)) {
    addLog(s, `\u30A8\u30CD\u30EB\u30AE\u30FC\u304C\u8DB3\u308A\u306A\u3044: ${attack.name}`);
    return s;
  }
  let damage = calcAttackDamage(s, atkPi, attack);
  damage = applyWeaknessResistance(damage, attacker, defender, s);
  dealDamage(defender, damage, s);
  addLog(s, `${attacker.name} \u306E ${attack.name}\uFF01 \u2192 ${defender.name} \u306B ${damage}\u30C0\u30E1\u30FC\u30B8\uFF08\u6B8BHP: ${defender.currentHp}\uFF09`);
  if (attack.text) {
    applyAttackEffect(s, atkPi, attack.text, attack.name, damage);
  }
  if (defender.currentHp <= 0) {
    handleKnockout(s, def, atk, defender);
  }
  for (let i = 0; i < def.bench.length; i++) {
    const b = def.bench[i];
    if (b && b.currentHp <= 0) {
      const prizes = b.isEx ? 2 : 1;
      atk.prizesTaken += prizes;
      const taken = def.prizes.splice(0, prizes);
      atk.hand.push(...taken);
      addLog(s, `${b.name} \u304C\u30D9\u30F3\u30C1\u3067\u304D\u305C\u3064\uFF01 \u30B5\u30A4\u30C9${prizes}\u679A`);
      def.bench[i] = null;
    }
  }
  s.phase = "between-turns";
  return s;
}
function dealDamage(target, damage, state) {
  target.currentHp = Math.max(0, target.currentHp - damage);
}
function handleKnockout(state, losingPlayer, winningPlayer, ko) {
  const prizes = ko.isEx ? 2 : 1;
  addLog(state, `${ko.name} \u304C\u304D\u305C\u3064\uFF01 \u30B5\u30A4\u30C9\u3092${prizes}\u679A\u53D6\u308B`);
  const taken = winningPlayer.prizes.splice(0, prizes);
  winningPlayer.prizesTaken += prizes;
  winningPlayer.hand.push(...taken);
  if (ko.toolCard) losingPlayer.discard.push(ko.toolCard);
  losingPlayer.discard.push(...ko.energies.map((e) => ({ supertype: "Energy", types: [e] })));
  losingPlayer.active = null;
  let bestIdx = -1, bestHp = -1;
  for (let i = 0; i < losingPlayer.bench.length; i++) {
    const b = losingPlayer.bench[i];
    if (b && b.currentHp > bestHp) {
      bestHp = b.currentHp;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0) {
    losingPlayer.active = losingPlayer.bench[bestIdx];
    losingPlayer.bench[bestIdx] = null;
    addLog(state, `${losingPlayer.active.name} \u304C\u30D0\u30C8\u30EB\u5834\u306B\u51FA\u305F`);
  }
}
function retreat(state, benchSlot) {
  const s = clone(state);
  const p = s.players[s.activePlayer];
  if (!p.active || !p.bench[benchSlot]) return s;
  const card = getCardData2(s, p.active.cardId);
  const cost = card?.retreatCost?.length ?? 0;
  if (p.active.energies.length < cost) {
    addLog(s, "\u306B\u3052\u308B\u30A8\u30CD\u30EB\u30AE\u30FC\u304C\u8DB3\u308A\u306A\u3044");
    return s;
  }
  for (let i = 0; i < cost; i++) {
    const e = p.active.energies.pop();
    p.discard.push({ supertype: "Energy", types: [e] });
  }
  const tmp = p.active;
  p.active = p.bench[benchSlot];
  p.bench[benchSlot] = tmp;
  addLog(s, `${p.active.name} \u304C\u30D0\u30C8\u30EB\u5834\u306B\u51FA\u305F`);
  return s;
}
function checkWinCondition(state) {
  const [p0, p1] = state.players;
  if (p0.prizesTaken >= 6) return 0;
  if (p1.prizesTaken >= 6) return 1;
  if (p0.deck.length === 0 && state.activePlayer === 0) return 1;
  if (p1.deck.length === 0 && state.activePlayer === 1) return 0;
  const p0HasPokemon = p0.active !== null || p0.bench.some((b) => b !== null);
  const p1HasPokemon = p1.active !== null || p1.bench.some((b) => b !== null);
  if (!p0HasPokemon) return 1;
  if (!p1HasPokemon) return 0;
  return null;
}
function applyStatusDamage(state) {
  for (const player of state.players) {
    if (!player.active) continue;
    const poke = player.active;
    if (poke.status === "poisoned") {
      dealDamage(poke, 10, state);
      addLog(state, `${poke.name} \u306F\u6BD2\u306710\u30C0\u30E1\u30FC\u30B8`);
    }
    if (poke.status === "burned") {
      if (Math.random() < 0.5) {
        dealDamage(poke, 20, state);
        addLog(state, `${poke.name} \u306F\u3084\u3051\u3069\u306720\u30C0\u30E1\u30FC\u30B8`);
      } else {
        poke.status = "none";
        addLog(state, `${poke.name} \u306E\u3084\u3051\u3069\u304C\u6CBB\u3063\u305F`);
      }
    }
  }
}
function applyStatusRecovery(state) {
  const active = state.players[state.activePlayer].active;
  if (!active) return;
  if (active.status === "paralyzed") {
    active.status = "none";
    addLog(state, `${active.name} \u306E\u307E\u3072\u304C\u6CBB\u3063\u305F`);
  }
  if (active.status === "asleep") {
    if (Math.random() < 0.5) {
      active.status = "none";
      addLog(state, `${active.name} \u304C\u76EE\u3092\u899A\u307E\u3057\u305F`);
    }
  }
}
function canUseAttack(pokemon, attack) {
  const available = [...pokemon.energies];
  for (const needed of attack.cost) {
    if (needed === "Colorless") continue;
    const idx = available.indexOf(needed);
    if (idx === -1) {
      const prismIdx = available.indexOf("Colorless");
      if (prismIdx === -1) return false;
      available.splice(prismIdx, 1);
    } else {
      available.splice(idx, 1);
    }
  }
  const colorlessCost = attack.cost.filter((c) => c === "Colorless").length;
  return available.length >= colorlessCost;
}
function inferEnergyType2(card) {
  if (card.types.length > 0) return card.types[0];
  const n = card.name.toLowerCase();
  if (n.includes("fire")) return "Fire";
  if (n.includes("water")) return "Water";
  if (n.includes("grass")) return "Grass";
  if (n.includes("lightning")) return "Lightning";
  if (n.includes("fighting")) return "Fighting";
  if (n.includes("darkness") || n.includes("dark")) return "Darkness";
  if (n.includes("metal") || n.includes("steel")) return "Metal";
  if (n.includes("psychic")) return "Psychic";
  return "Colorless";
}
function applyWeaknessResistance(damage, attacker, defender, state) {
  const defCard = getCardData2(state, defender.cardId);
  if (!defCard) return damage;
  const atkCard = getCardData2(state, attacker.cardId);
  const atkType = atkCard?.types[0];
  if (!atkType) return damage;
  const weakness = defCard.weaknesses.find((w) => {
    if (w.type === atkType) return true;
    if (w.type === "Fairy" && atkType === "Psychic") return true;
    return false;
  });
  if (weakness) damage *= 2;
  const resistance = defCard.resistances.find((r) => r.type === atkType);
  if (resistance) damage -= 30;
  return Math.max(0, damage);
}
function isBasicPokemon(card) {
  return card.supertype === "Pok\xE9mon" && card.subtypes.includes("Basic");
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
function addLog(state, msg) {
  state.log.push(msg);
}
var _cardDb = {};
function setCardDb(db) {
  _cardDb = db;
}
function getCardData2(state, id) {
  return _cardDb[id] ?? null;
}

// src/ai-player.ts
function chooseAction(state, pi) {
  const me = state.players[pi];
  const opp = state.players[pi === 0 ? 1 : 0];
  if (me.active === null) {
    const idx = me.hand.findIndex(isBasicPokemon);
    if (idx >= 0) return { type: "play-pokemon", cardIndex: idx };
    return { type: "end-turn" };
  }
  if (!state.firstTurn && me.active.cantAttackUntilTurn < state.turn) {
    const koAtk = findKOAttack(me, opp, state, pi);
    if (koAtk !== null) return { type: "attack", attackIndex: koAtk };
  }
  if (!me.supporterPlayedThisTurn) {
    const bossIdx = findInHand(me, (c) => c.name.startsWith("Boss's Orders") || c.name.startsWith("\u30DC\u30B9\u306E\u6307\u4EE4"));
    if (bossIdx >= 0) {
      const targetSlot = findKillableOppBench(me, opp, state, pi);
      if (targetSlot >= 0) {
        return { type: "play-trainer", cardIndex: bossIdx, trainerTarget: targetSlot };
      }
    }
  }
  const evolAction = chooseBestEvolve(state, pi);
  if (evolAction) return evolAction;
  const ultraBallIdx = findInHand(me, (c) => c.name === "Ultra Ball");
  if (ultraBallIdx >= 0 && me.hand.length >= 3 && me.deck.some((c) => c.supertype === "Pok\xE9mon")) {
    const discards = chooseTwoToDiscard(me, ultraBallIdx);
    if (discards.length >= 2) {
      return { type: "play-trainer", cardIndex: ultraBallIdx, discardIndices: discards };
    }
  }
  if (me.bench.some((b) => b === null)) {
    const poffinIdx = findInHand(me, (c) => c.name === "Buddy-Buddy Poffin");
    if (poffinIdx >= 0) {
      return { type: "play-trainer", cardIndex: poffinIdx };
    }
  }
  if (me.bench.some((b) => b === null)) {
    const basicIdx = me.hand.findIndex(isBasicPokemon);
    if (basicIdx >= 0) {
      return { type: "play-pokemon", cardIndex: basicIdx };
    }
  }
  if (!me.energyAttachedThisTurn) {
    const energyAction = chooseBestEnergyAttach(me, state, pi);
    if (energyAction) return energyAction;
  }
  if (!me.supporterPlayedThisTurn) {
    const suppAction = chooseSupportCard(state, pi);
    if (suppAction) return suppAction;
  }
  const itemAction = chooseItemCard(state, pi);
  if (itemAction) return itemAction;
  const toolAction = chooseToolCard(state, pi);
  if (toolAction) return toolAction;
  const stadiumAction = chooseStadiumCard(state, pi);
  if (stadiumAction) return stadiumAction;
  if (!state.firstTurn && me.active.cantAttackUntilTurn < state.turn) {
    const anyAtk = findBestAttack(me, opp, state, pi);
    if (anyAtk !== null) return { type: "attack", attackIndex: anyAtk };
  }
  const retreatAction = chooseRetreat(state, pi);
  if (retreatAction) return retreatAction;
  return { type: "end-turn" };
}
function chooseBestEvolve(state, pi) {
  if (state.firstTurn) return null;
  const me = state.players[pi];
  const candidates = [];
  const checkPokemon = (pokemon, slot) => {
    if (!pokemon || pokemon.evolveBlocked) return;
    for (let hi = 0; hi < me.hand.length; hi++) {
      const card = me.hand[hi];
      if (card.supertype !== "Pok\xE9mon") continue;
      const targetCard = getCardData2(state, pokemon.cardId);
      if (card.evolvesFrom === targetCard?.name) {
        const stage = card.subtypes.includes("Stage 2") ? 2 : card.subtypes.includes("Stage 1") ? 1 : 0;
        candidates.push({ evolCard: card, handIdx: hi, slot, stage });
      }
    }
  };
  checkPokemon(me.active, -1);
  for (let i = 0; i < me.bench.length; i++) checkPokemon(me.bench[i], i);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.stage - a.stage);
  const best = candidates[0];
  return { type: "evolve", cardIndex: best.handIdx, targetSlot: best.slot };
}
function findKOAttack(me, opp, state, pi) {
  if (!me.active || !opp.active) return null;
  const card = getCardData2(state, me.active.cardId);
  if (!card) return null;
  for (let i = 0; i < card.attacks.length; i++) {
    const atk = card.attacks[i];
    if (!canUseAttack(me.active, atk)) continue;
    const dmg = calcAttackDamage(state, pi, atk);
    if (dmg <= 0) continue;
    const actual = applyWeaknessResistanceEst(dmg, me.active, opp.active, state);
    if (actual >= opp.active.currentHp) return i;
  }
  return null;
}
function findBestAttack(me, opp, state, pi) {
  if (!me.active || !opp.active) return null;
  const card = getCardData2(state, me.active.cardId);
  if (!card) return null;
  let bestIdx = -1, bestDmg = -1;
  for (let i = 0; i < card.attacks.length; i++) {
    const atk = card.attacks[i];
    if (!canUseAttack(me.active, atk)) continue;
    const dmg = calcAttackDamage(state, pi, atk);
    if (dmg > 0 && dmg > bestDmg) {
      bestDmg = dmg;
      bestIdx = i;
    }
  }
  return bestIdx >= 0 ? bestIdx : null;
}
function findKillableOppBench(me, opp, state, pi) {
  if (!me.active) return -1;
  const card = getCardData2(state, me.active.cardId);
  if (!card) return -1;
  let bestDmg = 0;
  let bestAtk = -1;
  for (let i = 0; i < card.attacks.length; i++) {
    const atk = card.attacks[i];
    if (!canUseAttack(me.active, atk)) continue;
    const dmg = calcAttackDamage(state, pi, atk);
    if (dmg > bestDmg) {
      bestDmg = dmg;
      bestAtk = i;
    }
  }
  if (bestAtk < 0 || bestDmg === 0) return -1;
  let lowestHp = Infinity, targetSlot = -1;
  for (let i = 0; i < opp.bench.length; i++) {
    const b = opp.bench[i];
    if (!b) continue;
    const actual = applyWeaknessResistanceEst(bestDmg, me.active, b, state);
    if (actual >= b.currentHp && b.currentHp < lowestHp) {
      lowestHp = b.currentHp;
      targetSlot = i;
    }
  }
  return targetSlot;
}
function chooseBestEnergyAttach(me, state, pi) {
  const energyIdx = me.hand.findIndex((c) => c.supertype === "Energy");
  if (energyIdx < 0) return null;
  const energyCard = me.hand[energyIdx];
  const energyType = inferEnergyType3(energyCard);
  if (me.active) {
    const card = getCardData2(state, me.active.cardId);
    if (card && card.attacks.length > 0) {
      const neededTypes = card.attacks[0].cost;
      const wouldHelp = neededTypes.some((t) => t === energyType || t === "Colorless");
      if (wouldHelp) {
        return { type: "attach-energy", cardIndex: energyIdx, targetSlot: -1 };
      }
    }
    return { type: "attach-energy", cardIndex: energyIdx, targetSlot: -1 };
  }
  const benchSlot = me.bench.findIndex((b) => b !== null);
  if (benchSlot >= 0) {
    return { type: "attach-energy", cardIndex: energyIdx, targetSlot: benchSlot };
  }
  return null;
}
function chooseSupportCard(state, pi) {
  const me = state.players[pi];
  if (me.supporterPlayedThisTurn) return null;
  const ionoIdx = findInHand(me, (c) => c.name === "Iono");
  if (ionoIdx >= 0 && me.hand.length <= 4) {
    return { type: "play-trainer", cardIndex: ionoIdx };
  }
  const lillieIdx = findInHand(me, (c) => c.name.includes("Lillie's Determination") || c.name.includes("\u30EA\u30FC\u30EA\u30A8\u306E\u6C7A\u5FC3"));
  if (lillieIdx >= 0 && me.hand.length <= 5) {
    return { type: "play-trainer", cardIndex: lillieIdx };
  }
  const nemonaIdx = findInHand(me, (c) => c.name === "Nemona" || c.name === "\u30A2\u30AB\u30DE\u30C4");
  if (nemonaIdx >= 0 && me.hand.length <= 4) {
    return { type: "play-trainer", cardIndex: nemonaIdx };
  }
  const cipherIdx = findInHand(me, (c) => c.name === "Ciphermaniac's Codebreaking");
  if (cipherIdx >= 0 && me.hand.length <= 4) {
    return { type: "play-trainer", cardIndex: cipherIdx };
  }
  const nIdx = findInHand(me, (c) => c.name === "N's Plan" || c.name.includes("N\u306E\u7B4B\u66F8\u304D"));
  if (nIdx >= 0 && me.active) {
    const benchHasEnergy = me.bench.some((b) => b && b.energies.length > 0);
    const activeNeedsEnergy = me.active.energies.length < 3;
    if (benchHasEnergy && activeNeedsEnergy) {
      return { type: "play-trainer", cardIndex: nIdx };
    }
  }
  const redIdx = findInHand(me, (c) => c.name.includes("Red Card") || c.name.includes("\u30EC\u30C3\u30C9\u30AB\u30FC\u30C9"));
  if (redIdx >= 0 && me.prizes.length <= 3) {
    return { type: "play-trainer", cardIndex: redIdx };
  }
  const stampIdx = findInHand(me, (c) => c.name.includes("Unfair Stamp") || c.name.includes("\u30A2\u30F3\u30D5\u30A7\u30A2\u30B9\u30BF\u30F3\u30D7"));
  if (stampIdx >= 0) {
    const opp = state.players[pi === 0 ? 1 : 0];
    if (opp.prizes.length <= 4) {
      return { type: "play-trainer", cardIndex: stampIdx };
    }
  }
  return null;
}
function chooseItemCard(state, pi) {
  const me = state.players[pi];
  const ntIdx = findInHand(me, (c) => c.name === "Night Stretcher");
  if (ntIdx >= 0) {
    const hasUsefulInDiscard = me.discard.some((c) => c.supertype === "Pok\xE9mon" || c.supertype === "Energy");
    if (hasUsefulInDiscard) {
      return { type: "play-trainer", cardIndex: ntIdx };
    }
  }
  const palIdx = findInHand(me, (c) => c.name === "Pal Pad");
  if (palIdx >= 0 && me.discard.some((c) => c.subtypes.includes("Supporter"))) {
    return { type: "play-trainer", cardIndex: palIdx };
  }
  const eneSwIdx = findInHand(me, (c) => c.name.includes("\u3064\u3051\u304B\u3048") || c.name.includes("Switch") || c.name.includes("Transfer"));
  if (eneSwIdx >= 0 && me.active) {
    const card = getCardData2(state, me.active.cardId);
    if (card && !canUseAnyAttack(me, card, pi, state)) {
      if (me.bench.some((b) => b && b.energies.length > 0)) {
        return { type: "play-trainer", cardIndex: eneSwIdx };
      }
    }
  }
  const bugIdx = findInHand(me, (c) => c.name.includes("\u3080\u3057\u3068\u308A") || c.name.includes("Bug Catching"));
  if (bugIdx >= 0 && me.bench.some((b) => b === null)) {
    return { type: "play-trainer", cardIndex: bugIdx };
  }
  return null;
}
function chooseToolCard(state, pi) {
  const me = state.players[pi];
  const toolIdx = findInHand(me, (c) => c.subtypes.includes("Pok\xE9mon Tool") || c.subtypes.includes("Tool"));
  if (toolIdx < 0) return null;
  if (me.active && !me.active.toolCard) {
    return { type: "play-trainer", cardIndex: toolIdx, trainerTarget: -1 };
  }
  let bestSlot = -1, bestHp = -1;
  for (let i = 0; i < me.bench.length; i++) {
    const b = me.bench[i];
    if (b && !b.toolCard && b.maxHp > bestHp) {
      bestHp = b.maxHp;
      bestSlot = i;
    }
  }
  if (bestSlot >= 0) {
    return { type: "play-trainer", cardIndex: toolIdx, trainerTarget: bestSlot };
  }
  return null;
}
function chooseStadiumCard(state, pi) {
  const me = state.players[pi];
  const stadIdx = findInHand(me, (c) => c.subtypes.includes("Stadium"));
  if (stadIdx < 0) return null;
  if (!me.stadium) {
    return { type: "play-trainer", cardIndex: stadIdx };
  }
  return null;
}
function chooseRetreat(state, pi) {
  const me = state.players[pi];
  if (!me.active) return null;
  const card = getCardData2(state, me.active.cardId);
  const cost = card?.retreatCost?.length ?? 0;
  if (me.active.currentHp <= 30 && me.active.energies.length >= cost) {
    const bestBench = findBestBenchSlot(me);
    if (bestBench >= 0 && (me.bench[bestBench]?.maxHp ?? 0) > me.active.currentHp) {
      return { type: "retreat", targetSlot: bestBench };
    }
  }
  return null;
}
function findInHand(me, pred) {
  return me.hand.findIndex(pred);
}
function findBestBenchSlot(me) {
  let best = -1, bestHp = -1;
  for (let i = 0; i < me.bench.length; i++) {
    const b = me.bench[i];
    if (b && b.currentHp > bestHp) {
      bestHp = b.currentHp;
      best = i;
    }
  }
  return best;
}
function chooseTwoToDiscard(me, excludeIdx) {
  const idxs = [];
  for (let i = 0; i < me.hand.length && idxs.length < 2; i++) {
    if (i === excludeIdx) continue;
    const c = me.hand[i];
    if (c.supertype === "Energy") idxs.push(i);
  }
  for (let i = 0; i < me.hand.length && idxs.length < 2; i++) {
    if (i === excludeIdx || idxs.includes(i)) continue;
    idxs.push(i);
  }
  return idxs;
}
function canUseAnyAttack(me, card, pi, state) {
  if (!me.active) return false;
  for (const atk of card.attacks ?? []) {
    if (canUseAttack(me.active, atk) && calcAttackDamage(state, pi, atk) > 0) return true;
  }
  return false;
}
function inferEnergyType3(card) {
  if (card.types.length > 0) return card.types[0];
  const n = card.name.toLowerCase();
  if (n.includes("fire")) return "Fire";
  if (n.includes("water")) return "Water";
  if (n.includes("grass")) return "Grass";
  if (n.includes("lightning")) return "Lightning";
  if (n.includes("fighting")) return "Fighting";
  if (n.includes("darkness") || n.includes("dark")) return "Darkness";
  if (n.includes("metal") || n.includes("steel")) return "Metal";
  if (n.includes("psychic")) return "Psychic";
  return "Colorless";
}
function applyWeaknessResistanceEst(damage, attacker, defender, state) {
  const defCard = getCardData2(state, defender.cardId);
  if (!defCard) return damage;
  const atkCard = getCardData2(state, attacker.cardId);
  const atkType = atkCard?.types?.[0];
  if (!atkType) return damage;
  const weakness = defCard.weaknesses?.find((w) => w.type === atkType);
  if (weakness) damage *= 2;
  const resist = defCard.resistances?.find((r) => r.type === atkType);
  if (resist) damage = Math.max(0, damage - 30);
  return damage;
}

// src/simulator.ts
var MAX_TURNS = 200;
function runGame(deckA, deckB, firstPlayer = 0, verbose = false) {
  let state = initGame(deckA, deckB);
  state.activePlayer = firstPlayer;
  state = setupPhase(state);
  let totalTurns = 0;
  while (state.winner === null && totalTurns < MAX_TURNS) {
    state = startTurn(state);
    let actionCount = 0;
    const MAX_ACTIONS = 20;
    while (actionCount < MAX_ACTIONS) {
      const action = chooseAction(state, state.activePlayer);
      state = applyAction(state, action);
      if (action.type === "end-turn" || action.type === "attack") break;
      actionCount++;
    }
    state = endTurn(state);
    totalTurns++;
  }
  const winner = state.winner ?? "draw";
  return {
    winner: winner === "draw" ? "draw" : winner,
    turns: totalTurns,
    log: verbose ? state.log : void 0
  };
}
function setupPhase(state) {
  let s = { ...state };
  const firstPlayer = state.activePlayer;
  for (const pi of [0, 1]) {
    s.activePlayer = pi;
    let actionCount = 0;
    while (s.players[pi].active === null && actionCount < 10) {
      const action = chooseAction(s, pi);
      s = applyAction(s, action);
      s.activePlayer = pi;
      actionCount++;
    }
  }
  s.activePlayer = firstPlayer;
  s.phase = "main";
  return s;
}
function applyAction(state, action) {
  switch (action.type) {
    case "play-pokemon":
      return playBasicToActive(state, action.cardIndex ?? 0);
    case "evolve":
      return evolvePokemon(state, action.cardIndex ?? 0, action.targetSlot ?? -1);
    case "attach-energy":
      return attachEnergy(state, action.cardIndex ?? 0, action.targetSlot ?? -1);
    case "play-trainer":
      return playTrainer(
        state,
        action.cardIndex ?? 0,
        action.trainerTarget,
        action.discardIndices
      );
    case "attack":
      return useAttack(state, action.attackIndex ?? 0);
    case "retreat":
      return retreat(state, action.targetSlot ?? 0);
    case "end-turn":
    default:
      return state;
  }
}
async function runSimulation(deckA, deckB, iterations = 1e3, onProgress) {
  let winsA = 0, winsB = 0, draws = 0, totalTurns = 0;
  for (let i = 0; i < iterations; i++) {
    const firstPlayer = i % 2 === 0 ? 0 : 1;
    const result = runGame(deckA, deckB, firstPlayer);
    if (result.winner === 0) winsA++;
    else if (result.winner === 1) winsB++;
    else draws++;
    totalTurns += result.turns;
    if (onProgress && i % 100 === 0) onProgress(i, iterations);
    if (i % 200 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return {
    iterations,
    winRateA: Math.round(winsA / iterations * 1e3) / 10,
    winRateB: Math.round(winsB / iterations * 1e3) / 10,
    drawRate: Math.round(draws / iterations * 1e3) / 10,
    avgTurns: Math.round(totalTurns / iterations * 10) / 10,
    winsA,
    winsB,
    draws
  };
}
function initSimulator(cardDb) {
  setCardDb(cardDb);
}
export {
  initSimulator,
  runGame,
  runSimulation
};
