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
    isEx
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
    prizesTaken: 0
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
    if (player.deck.length === 0) {
      return;
    }
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
    p.bench[slot] = createActivePokemon(card);
    addLog(s, `${card.name} \u3092\u30D9\u30F3\u30C1\u306B\u51FA\u3057\u305F`);
  }
  return s;
}
function attachEnergy(state, handIndex, targetSlot) {
  const s = clone(state);
  const p = s.players[s.activePlayer];
  const card = p.hand[handIndex];
  if (!card || card.supertype !== "Energy") return s;
  const target = targetSlot === -1 ? p.active : p.bench[targetSlot];
  if (!target) return s;
  const energyType = inferEnergyType(card);
  target.energies.push(energyType);
  p.hand.splice(handIndex, 1);
  p.discard.push(card);
  addLog(s, `${target.name} \u306B ${energyType} \u30A8\u30CD\u30EB\u30AE\u30FC\u3092\u3064\u3051\u305F`);
  return s;
}
function useAttack(state, attackIndex) {
  const s = clone(state);
  if (s.firstTurn) {
    addLog(s, "\u5148\u884C1\u30BF\u30FC\u30F3\u76EE\u306F\u30EF\u30B6\u3092\u4F7F\u3048\u306A\u3044");
    return s;
  }
  const atk = s.players[s.activePlayer];
  const def = s.players[s.activePlayer === 0 ? 1 : 0];
  if (!atk.active || !def.active) return s;
  const attacker = atk.active;
  const defender = def.active;
  const card = getCardData(s, attacker.cardId);
  const attack = card?.attacks[attackIndex];
  if (!attack) return s;
  if (!canUseAttack(attacker, attack)) {
    addLog(s, `\u30A8\u30CD\u30EB\u30AE\u30FC\u304C\u8DB3\u308A\u306A\u3044: ${attack.name}`);
    return s;
  }
  let damage = parseDamage(attack.damage);
  damage = applyWeaknessResistance(damage, attacker, defender, s);
  dealDamage(defender, damage, s);
  addLog(s, `${attacker.name} \u306E ${attack.name}\uFF01 \u2192 ${defender.name} \u306B ${damage}\u30C0\u30E1\u30FC\u30B8`);
  if (defender.currentHp <= 0) {
    handleKnockout(s, def, atk, defender);
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
  const taken = losingPlayer.prizes.splice(0, prizes);
  winningPlayer.prizesTaken += prizes;
  winningPlayer.hand.push(...taken);
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
  const cost = p.active.retreatCost?.length ?? p.active.card?.retreatCost?.length ?? 0;
  if (p.active.energies.length < cost) {
    addLog(s, "\u306B\u3052\u308B\u30A8\u30CD\u30EB\u30AE\u30FC\u304C\u8DB3\u308A\u306A\u3044");
    return s;
  }
  for (let i = 0; i < cost; i++) p.active.energies.pop();
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
      const roll = Math.random() < 0.5;
      if (!roll) {
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
    if (idx === -1) return false;
    available.splice(idx, 1);
  }
  const colorlessCost = attack.cost.filter((c) => c === "Colorless").length;
  return available.length >= colorlessCost;
}
function inferEnergyType(card) {
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
  const defCard = getCardData(state, defender.cardId);
  if (!defCard) return damage;
  const atkType = getCardData(state, attacker.cardId)?.types[0];
  if (!atkType) return damage;
  const weakness = defCard.weaknesses.find((w) => w.type === atkType);
  if (weakness) damage *= 2;
  const resistance = defCard.resistances.find((r) => r.type === atkType);
  if (resistance) damage -= 30;
  return Math.max(0, damage);
}
function parseDamage(dmgStr) {
  if (!dmgStr) return 0;
  const n = parseInt(dmgStr.replace(/[^0-9]/g, ""));
  return isNaN(n) ? 0 : n;
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
function getCardData(state, id) {
  return _cardDb[id] ?? null;
}

// src/ai-player.ts
function chooseAction(state, playerIndex) {
  const me = state.players[playerIndex];
  const opp = state.players[playerIndex === 0 ? 1 : 0];
  if (me.active === null) {
    const basicIdx = me.hand.findIndex((c) => isBasicPokemon(c));
    if (basicIdx >= 0) return { type: "play-pokemon", cardIndex: basicIdx, targetSlot: -1 };
    return { type: "end-turn" };
  }
  const koAttack = findKOAttack(me, opp, state);
  if (koAttack !== null && state.phase === "main" && !state.firstTurn) {
    return { type: "attack", attackIndex: koAttack };
  }
  if (me.bench.some((b) => b === null)) {
    const basicIdx = me.hand.findIndex((c) => isBasicPokemon(c));
    if (basicIdx >= 0) {
      const slot = me.bench.findIndex((b) => b === null);
      return { type: "play-pokemon", cardIndex: basicIdx, targetSlot: slot };
    }
  }
  const energyIdx = me.hand.findIndex((c) => c.supertype === "Energy");
  if (energyIdx >= 0 && me.active !== null) {
    return { type: "attach-energy", cardIndex: energyIdx, targetSlot: -1 };
  }
  const anyAttack = findBestAttack(me, opp, state);
  if (anyAttack !== null && state.phase === "main" && !state.firstTurn) {
    return { type: "attack", attackIndex: anyAttack };
  }
  return { type: "end-turn" };
}
function findKOAttack(me, opp, state) {
  if (!me.active || !opp.active) return null;
  const card = getCardData(state, me.active.cardId);
  if (!card) return null;
  for (let i = 0; i < card.attacks.length; i++) {
    const atk = card.attacks[i];
    if (!canUseAttack(me.active, atk)) continue;
    const dmg = estimateDamage(atk, me.active, opp.active, state);
    if (dmg >= opp.active.currentHp) return i;
  }
  return null;
}
function findBestAttack(me, opp, state) {
  if (!me.active || !opp.active) return null;
  const card = getCardData(state, me.active.cardId);
  if (!card) return null;
  let bestIdx = -1;
  let bestDmg = -1;
  for (let i = 0; i < card.attacks.length; i++) {
    const atk = card.attacks[i];
    if (!canUseAttack(me.active, atk)) continue;
    const dmg = estimateDamage(atk, me.active, opp.active, state);
    if (dmg > 0 && dmg > bestDmg) {
      bestDmg = dmg;
      bestIdx = i;
    }
  }
  return bestIdx >= 0 ? bestIdx : null;
}
function estimateDamage(attack, attacker, defender, state) {
  let dmg = parseDamage(attack.damage);
  const atkCard = getCardData(state, attacker.cardId);
  const defCard = getCardData(state, defender.cardId);
  if (atkCard && defCard) {
    const atkType = atkCard.types?.[0];
    const weakness = defCard.weaknesses?.find((w) => w.type === atkType);
    if (weakness) dmg *= 2;
    const resist = defCard.resistances?.find((r) => r.type === atkType);
    if (resist) dmg = Math.max(0, dmg - 30);
  }
  return dmg;
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
  for (const pi of [0, 1]) {
    let actionCount = 0;
    while (s.players[pi].active === null && actionCount < 10) {
      const action = chooseAction({ ...s, activePlayer: pi }, pi);
      s = applyAction(s, { ...action });
      s.activePlayer = pi;
      actionCount++;
    }
  }
  s.phase = "main";
  return s;
}
function applyAction(state, action) {
  switch (action.type) {
    case "play-pokemon":
      return playBasicToActive(state, action.cardIndex ?? 0);
    case "attach-energy":
      return attachEnergy(state, action.cardIndex ?? 0, action.targetSlot ?? -1);
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
