/**
 * game-engine.ts — ポケカ コアルールエンジン
 * デッキ非依存のルールのみ実装。カード個別効果はeffects/で別途実装。
 */

import type {
  GameState, PlayerState, PlayerIndex, ActivePokemon,
  CardData, Action, Winner, StatusCondition,
} from './types.js';

// ===== セットアップ =====

export function createActivePokemon(card: CardData): ActivePokemon {
  const isEx = card.subtypes.some(s =>
    s === 'ex' || s === 'EX' || s === 'V' || s === 'VMAX' || s === 'VSTAR'
  );
  return {
    cardId:         card.id,
    name:           card.name,
    maxHp:          card.hp ?? 0,
    currentHp:      card.hp ?? 0,
    status:         'none',
    energies:       [],
    damageCounters: 0,
    isEx,
  };
}

export function createPlayerState(deck: CardData[]): PlayerState {
  const shuffled = shuffle([...deck]);
  const prizes   = shuffled.splice(0, 6);
  const hand     = shuffled.splice(0, 7);
  return {
    deck:        shuffled,
    hand,
    bench:       [null, null, null, null, null],
    active:      null,
    discard:     [],
    prizes,
    prizesTaken: 0,
  };
}

export function initGame(deckA: CardData[], deckB: CardData[]): GameState {
  const p0 = createPlayerState(deckA);
  const p1 = createPlayerState(deckB);

  // マリガン処理（手札にポケモンがなければ引き直し・実装簡略版）
  ensureBasicInHand(p0, deckA);
  ensureBasicInHand(p1, deckB);

  return {
    turn:         1,
    activePlayer: 0,
    phase:        'setup',
    players:      [p0, p1],
    winner:       null,
    firstTurn:    true,
    log:          [],
  };
}

function ensureBasicInHand(player: PlayerState, origDeck: CardData[]): void {
  let attempts = 0;
  while (!player.hand.some(isBasicPokemon) && attempts < 10) {
    player.discard.push(...player.hand);
    const full = shuffle([...origDeck]);
    player.prizes = full.splice(0, 6);
    player.hand   = full.splice(0, 7);
    player.deck   = full;
    attempts++;
  }
}

// ===== フェーズ進行 =====

export function startTurn(state: GameState): GameState {
  const s = clone(state);
  const p = s.players[s.activePlayer];

  // ドローフェーズ（先行1ターン目はドローなし）
  if (!s.firstTurn) {
    drawCards(p, 1, s);
  }
  s.phase = 'main';
  addLog(s, `--- ターン${s.turn} (プレイヤー${s.activePlayer}) ---`);
  return s;
}

export function endTurn(state: GameState): GameState {
  const s = clone(state);

  // 状態異常の処理（番の終わりに毒・やけどダメージ）
  applyStatusDamage(s);

  // ねむり・まひのチェック
  applyStatusRecovery(s);

  // 勝敗チェック
  const winner = checkWinCondition(s);
  if (winner !== null) {
    s.winner = winner;
    s.phase  = 'end';
    addLog(s, `勝者: プレイヤー${winner}`);
    return s;
  }

  // 次のプレイヤーへ
  s.activePlayer = (s.activePlayer === 0 ? 1 : 0) as PlayerIndex;
  s.turn++;
  s.firstTurn = false;
  s.phase = 'draw';
  return s;
}

// ===== ドロー =====

export function drawCards(player: PlayerState, count: number, state: GameState): void {
  for (let i = 0; i < count; i++) {
    if (player.deck.length === 0) {
      // デッキ切れ → 負け（呼び元でcheckWinConditionが処理）
      return;
    }
    player.hand.push(player.deck.shift()!);
  }
}

// ===== ベンチ展開・進化 =====

export function playBasicToActive(state: GameState, handIndex: number): GameState {
  const s = clone(state);
  const p = s.players[s.activePlayer];
  const card = p.hand[handIndex];
  if (!card || !isBasicPokemon(card)) return s;

  p.hand.splice(handIndex, 1);
  if (p.active === null) {
    p.active = createActivePokemon(card);
    addLog(s, `${card.name} をバトル場に出した`);
  } else if (p.bench.some(b => b === null)) {
    const slot = p.bench.findIndex(b => b === null);
    p.bench[slot] = createActivePokemon(card);
    addLog(s, `${card.name} をベンチに出した`);
  }
  return s;
}

export function evolvePokemon(state: GameState, handIndex: number, targetSlot: number): GameState {
  const s = clone(state);
  const p = s.players[s.activePlayer];
  const evolCard = p.hand[handIndex];
  const target = targetSlot === -1 ? p.active : p.bench[targetSlot];
  if (!evolCard || !target) return s;

  const targetCard = getCardData(state, target.cardId);
  if (evolCard.evolvesFrom !== targetCard?.name) return s;

  // 進化: HPを引き継ぎつつ最大HPを更新
  const diff = (evolCard.hp ?? 0) - (target.maxHp);
  target.cardId  = evolCard.id;
  target.name    = evolCard.name;
  target.maxHp   = evolCard.hp ?? target.maxHp;
  target.currentHp = Math.min(target.currentHp + Math.max(0, diff), target.maxHp);
  target.isEx    = evolCard.subtypes.some(s => ['ex','EX','V','VMAX','VSTAR'].includes(s));
  target.status  = 'none'; // 進化で状態異常回復

  p.hand.splice(handIndex, 1);
  p.discard.push(targetCard!); // 進化前をトラッシュ
  addLog(s, `${target.name} に進化した`);
  return s;
}

// ===== エネルギー =====

export function attachEnergy(state: GameState, handIndex: number, targetSlot: number): GameState {
  const s = clone(state);
  const p = s.players[s.activePlayer];
  const card = p.hand[handIndex];
  if (!card || card.supertype !== 'Energy') return s;

  const target = targetSlot === -1 ? p.active : p.bench[targetSlot];
  if (!target) return s;

  const energyType = inferEnergyType(card);
  target.energies.push(energyType);
  p.hand.splice(handIndex, 1);
  p.discard.push(card);
  addLog(s, `${target.name} に ${energyType} エネルギーをつけた`);
  return s;
}

// ===== ワザ =====

export function useAttack(state: GameState, attackIndex: number): GameState {
  const s = clone(state);
  if (s.firstTurn) { addLog(s, '先行1ターン目はワザを使えない'); return s; }

  const atk   = s.players[s.activePlayer];
  const def   = s.players[s.activePlayer === 0 ? 1 : 0];
  if (!atk.active || !def.active) return s;

  const attacker = atk.active;
  const defender = def.active;
  const card = getCardData(s, attacker.cardId);
  const attack = card?.attacks[attackIndex];
  if (!attack) return s;

  // エネルギーチェック（簡略版）
  if (!canUseAttack(attacker, attack)) {
    addLog(s, `エネルギーが足りない: ${attack.name}`);
    return s;
  }

  // ダメージ計算
  let damage = parseDamage(attack.damage);
  damage = applyWeaknessResistance(damage, attacker, defender, s);

  dealDamage(defender, damage, s);
  addLog(s, `${attacker.name} の ${attack.name}！ → ${defender.name} に ${damage}ダメージ`);

  // きぜつチェック
  if (defender.currentHp <= 0) {
    handleKnockout(s, def, atk, defender);
  }

  s.phase = 'between-turns';
  return s;
}

// ===== ダメージ・きぜつ =====

export function dealDamage(target: ActivePokemon, damage: number, state: GameState): void {
  target.currentHp = Math.max(0, target.currentHp - damage);
}

function handleKnockout(state: GameState, losingPlayer: PlayerState, winningPlayer: PlayerState, ko: ActivePokemon): void {
  const prizes = ko.isEx ? 2 : 1;
  addLog(state, `${ko.name} がきぜつ！ サイドを${prizes}枚取る`);

  // サイドを取る
  const taken = losingPlayer.prizes.splice(0, prizes);
  winningPlayer.prizesTaken += prizes;
  winningPlayer.hand.push(...taken);
  losingPlayer.discard.push(...ko.energies.map(e => ({ supertype: 'Energy', types: [e] } as any)));

  // きぜつ直後にベンチのポケモンをバトル場へ昇格（HPが一番高いものを選ぶ）
  losingPlayer.active = null;
  let bestIdx = -1, bestHp = -1;
  for (let i = 0; i < losingPlayer.bench.length; i++) {
    const b = losingPlayer.bench[i];
    if (b && b.currentHp > bestHp) { bestHp = b.currentHp; bestIdx = i; }
  }
  if (bestIdx >= 0) {
    losingPlayer.active = losingPlayer.bench[bestIdx];
    losingPlayer.bench[bestIdx] = null;
    addLog(state, `${losingPlayer.active!.name} がバトル場に出た`);
  }
}

export function retreat(state: GameState, benchSlot: number): GameState {
  const s = clone(state);
  const p = s.players[s.activePlayer];
  if (!p.active || !p.bench[benchSlot]) return s;

  const cost = p.active.retreatCost?.length ?? p.active.card?.retreatCost?.length ?? 0;
  // エネルギーコストは簡略実装（energiesから取るだけ）
  if (p.active.energies.length < cost) {
    addLog(s, 'にげるエネルギーが足りない'); return s;
  }
  for (let i = 0; i < cost; i++) p.active.energies.pop();

  const tmp = p.active;
  p.active = p.bench[benchSlot]!;
  p.bench[benchSlot] = tmp;
  addLog(s, `${p.active.name} がバトル場に出た`);
  return s;
}

// ===== 勝敗判定 =====

export function checkWinCondition(state: GameState): Winner {
  const [p0, p1] = state.players;

  // サイドを全て取った
  if (p0.prizesTaken >= 6) return 0;
  if (p1.prizesTaken >= 6) return 1;

  // デッキ切れ（番の始めにドローできない）
  if (p0.deck.length === 0 && state.activePlayer === 0) return 1;
  if (p1.deck.length === 0 && state.activePlayer === 1) return 0;

  // バトル場・ベンチにポケモンがいない
  const p0HasPokemon = p0.active !== null || p0.bench.some(b => b !== null);
  const p1HasPokemon = p1.active !== null || p1.bench.some(b => b !== null);
  if (!p0HasPokemon) return 1;
  if (!p1HasPokemon) return 0;

  return null;
}

// ===== 状態異常 =====

function applyStatusDamage(state: GameState): void {
  for (const player of state.players) {
    if (!player.active) continue;
    const poke = player.active;
    if (poke.status === 'poisoned') {
      dealDamage(poke, 10, state);
      addLog(state, `${poke.name} は毒で10ダメージ`);
    }
    if (poke.status === 'burned') {
      const roll = Math.random() < 0.5; // コインフリップ
      if (!roll) {
        dealDamage(poke, 20, state);
        addLog(state, `${poke.name} はやけどで20ダメージ`);
      } else {
        poke.status = 'none';
        addLog(state, `${poke.name} のやけどが治った`);
      }
    }
  }
}

function applyStatusRecovery(state: GameState): void {
  const active = state.players[state.activePlayer].active;
  if (!active) return;
  if (active.status === 'paralyzed') {
    active.status = 'none';
    addLog(state, `${active.name} のまひが治った`);
  }
  if (active.status === 'asleep') {
    if (Math.random() < 0.5) {
      active.status = 'none';
      addLog(state, `${active.name} が目を覚ました`);
    }
  }
}

// ===== ユーティリティ =====

export function canUseAttack(pokemon: ActivePokemon, attack: { cost: string[] }): boolean {
  const available = [...pokemon.energies] as string[];
  // Satisfy typed costs first (consume exact-match energies)
  for (const needed of attack.cost) {
    if (needed === 'Colorless') continue;
    const idx = available.indexOf(needed);
    if (idx === -1) return false;
    available.splice(idx, 1);
  }
  // Remaining colorless costs can be paid by any leftover energy
  const colorlessCost = attack.cost.filter(c => c === 'Colorless').length;
  return available.length >= colorlessCost;
}

function inferEnergyType(card: CardData): string {
  if (card.types.length > 0) return card.types[0] as string;
  const n = card.name.toLowerCase();
  if (n.includes('fire'))      return 'Fire';
  if (n.includes('water'))     return 'Water';
  if (n.includes('grass'))     return 'Grass';
  if (n.includes('lightning')) return 'Lightning';
  if (n.includes('fighting'))  return 'Fighting';
  if (n.includes('darkness') || n.includes('dark')) return 'Darkness';
  if (n.includes('metal') || n.includes('steel'))   return 'Metal';
  if (n.includes('psychic'))   return 'Psychic';
  return 'Colorless';
}

function applyWeaknessResistance(
  damage: number,
  attacker: ActivePokemon,
  defender: ActivePokemon,
  state: GameState,
): number {
  const defCard = getCardData(state, defender.cardId);
  if (!defCard) return damage;

  const atkType = getCardData(state, attacker.cardId)?.types[0];
  if (!atkType) return damage;

  const weakness = defCard.weaknesses.find(w => w.type === atkType);
  if (weakness) damage *= 2; // SVは×2固定

  const resistance = defCard.resistances.find(r => r.type === atkType);
  if (resistance) damage -= 30;

  return Math.max(0, damage);
}

export function parseDamage(dmgStr: string): number {
  if (!dmgStr) return 0;
  const n = parseInt(dmgStr.replace(/[^0-9]/g, ''));
  return isNaN(n) ? 0 : n;
}

export function isBasicPokemon(card: CardData): boolean {
  return card.supertype === 'Pokémon' && card.subtypes.includes('Basic');
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function addLog(state: GameState, msg: string): void {
  state.log.push(msg);
}

// cards.json へのアクセス（ランタイムで注入）
let _cardDb: Record<string, any> = {};
export function setCardDb(db: Record<string, any>): void { _cardDb = db; }
export function getCardData(state: GameState, id: string): any {
  return _cardDb[id] ?? null;
}
