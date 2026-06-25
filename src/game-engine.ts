/**
 * game-engine.ts — ポケカ コアルールエンジン
 */
import type {
  GameState, PlayerState, PlayerIndex, ActivePokemon,
  CardData, Action, Winner,
} from './types.js';
import { applyTrainerEffect, applyAttackEffect, calcAttackDamage, makeBenchPokemon } from './effects.js';

// ===== セットアップ =====

export function createActivePokemon(card: CardData): ActivePokemon {
  const isEx = card.subtypes.some(s =>
    s === 'ex' || s === 'EX' || s === 'V' || s === 'VMAX' || s === 'VSTAR'
  );
  return {
    cardId:            card.id,
    name:              card.name,
    maxHp:             card.hp ?? 0,
    currentHp:         card.hp ?? 0,
    status:            'none',
    energies:          [],
    damageCounters:    0,
    isEx,
    evolveBlocked:     true,
    toolCard:          null,
    cantAttackUntilTurn: -1,
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
    supporterPlayedThisTurn: false,
    energyAttachedThisTurn:  false,
    stadium:     null,
  };
}

export function initGame(deckA: CardData[], deckB: CardData[]): GameState {
  const p0 = createPlayerState(deckA);
  const p1 = createPlayerState(deckB);
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

  if (!s.firstTurn) {
    drawCards(p, 1, s);
  }

  // ターン開始時フラグをリセット
  p.supporterPlayedThisTurn = false;
  p.energyAttachedThisTurn  = false;

  // 進化ブロック解除（前のターンに出したポケモンは今ターンから進化可能）
  if (p.active) p.active.evolveBlocked = false;
  for (const b of p.bench) if (b) b.evolveBlocked = false;

  // cantAttackUntilTurn: ターン番号で管理（s.turn <= cantAttackUntilTurn なら攻撃不可）
  if (p.active && p.active.cantAttackUntilTurn >= s.turn) {
    addLog(s, `${p.active.name} は今ターン攻撃できない（前ターンの効果）`);
  }

  s.phase = 'main';
  addLog(s, `--- ターン${s.turn} (プレイヤー${s.activePlayer}) ---`);
  return s;
}

export function endTurn(state: GameState): GameState {
  const s = clone(state);

  applyStatusDamage(s);
  applyStatusRecovery(s);

  // cantAttackUntilTurnはターン番号比較で自動消滅するためリセット不要

  const winner = checkWinCondition(s);
  if (winner !== null) {
    s.winner = winner;
    s.phase  = 'end';
    addLog(s, `勝者: プレイヤー${winner}`);
    return s;
  }

  s.activePlayer = (s.activePlayer === 0 ? 1 : 0) as PlayerIndex;
  s.turn++;
  s.firstTurn = false;
  s.phase = 'draw';
  return s;
}

// ===== ドロー =====

export function drawCards(player: PlayerState, count: number, state: GameState): void {
  for (let i = 0; i < count; i++) {
    if (player.deck.length === 0) return;
    player.hand.push(player.deck.shift()!);
  }
}

// ===== ベンチ展開 =====

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
    p.bench[slot] = makeBenchPokemon(card, s.turn);
    addLog(s, `${card.name} をベンチに出した`);
  }
  return s;
}

// ===== 進化 =====

export function evolvePokemon(state: GameState, handIndex: number, targetSlot: number): GameState {
  const s = clone(state);
  const p = s.players[s.activePlayer];
  const evolCard = p.hand[handIndex];
  if (!evolCard || evolCard.supertype !== 'Pokémon') return s;

  const target = targetSlot === -1 ? p.active : p.bench[targetSlot];
  if (!target) return s;

  // 進化ブロックチェック
  if (target.evolveBlocked) {
    addLog(s, `${target.name} は今ターン進化できない`);
    return s;
  }

  // 先行1ターン目は進化不可
  if (s.firstTurn) {
    addLog(s, `先行1ターン目は進化できない`);
    return s;
  }

  // 進化先チェック（evolvesFromが一致するか）
  const targetCard = getCardData(s, target.cardId);
  if (evolCard.evolvesFrom !== targetCard?.name) {
    addLog(s, `${evolCard.name} は ${target.name} に進化できない`);
    return s;
  }

  // 進化実行
  const hpDiff = (evolCard.hp ?? 0) - target.maxHp;
  const oldTool = target.toolCard;
  const oldEnergies = target.energies;
  const oldStatus = target.status;

  target.cardId   = evolCard.id;
  target.name     = evolCard.name;
  target.maxHp    = (evolCard.hp ?? 0) + (oldTool ? 100 : 0); // ヒーローマント継承
  target.currentHp = Math.min(target.currentHp + Math.max(0, hpDiff), target.maxHp);
  target.isEx     = evolCard.subtypes.some(s => ['ex','EX','V','VMAX','VSTAR'].includes(s));
  target.status   = 'none'; // 進化で状態異常回復
  target.energies = oldEnergies;
  target.toolCard = oldTool;
  target.evolveBlocked = true; // 進化したターンはさらに進化不可
  target.cantAttackUntilTurn = -1;

  p.hand.splice(handIndex, 1);
  if (targetCard) p.discard.push(targetCard);
  addLog(s, `${target.name} に進化した（HP: ${target.currentHp}/${target.maxHp}）`);
  return s;
}

// ===== エネルギー =====

export function attachEnergy(state: GameState, handIndex: number, targetSlot: number): GameState {
  const s = clone(state);
  const p = s.players[s.activePlayer];

  // 1ターン1エネルギー制限
  if (p.energyAttachedThisTurn) {
    addLog(s, 'エネルギーはすでに付けた');
    return s;
  }

  const card = p.hand[handIndex];
  if (!card || card.supertype !== 'Energy') return s;

  const target = targetSlot === -1 ? p.active : p.bench[targetSlot];
  if (!target) return s;

  const energyType = inferEnergyType(card);
  target.energies.push(energyType);
  p.hand.splice(handIndex, 1);
  p.discard.push(card);
  p.energyAttachedThisTurn = true;
  addLog(s, `${target.name} に ${energyType} エネルギーをつけた`);
  return s;
}

// ===== トレーナー =====

export function playTrainer(
  state:        GameState,
  handIndex:    number,
  target?:      number,
  discards?:    number[],
): GameState {
  const s = clone(state);
  const p = s.players[s.activePlayer];
  const card = p.hand[handIndex];
  if (!card || card.supertype !== 'Trainer') return s;

  const isSupporter = card.subtypes.includes('Supporter');
  const isTool      = card.subtypes.includes('Pokémon Tool') || card.subtypes.includes('Tool');
  const isStadium   = card.subtypes.includes('Stadium');
  const isItem      = !isSupporter && !isTool && !isStadium;

  // サポートは1ターン1枚
  if (isSupporter && p.supporterPlayedThisTurn) {
    addLog(s, 'サポートはすでに使った');
    return s;
  }

  // 手札から取り除く（効果適用前）
  p.hand.splice(handIndex, 1);
  if (!isTool && !isStadium) p.discard.push(card); // ツール・スタジアムは場に出る

  // 効果適用
  const pi = s.activePlayer;
  const after = applyTrainerEffect(s, pi, card, target, discards);

  if (isSupporter) after.players[pi].supporterPlayedThisTurn = true;

  return after;
}

// ===== ワザ =====

export function useAttack(state: GameState, attackIndex: number): GameState {
  const s = clone(state);
  if (s.firstTurn) { addLog(s, '先行1ターン目はワザを使えない'); return s; }

  const atkPi = s.activePlayer;
  const defPi = atkPi === 0 ? 1 : 0;
  const atk   = s.players[atkPi];
  const def   = s.players[defPi];
  if (!atk.active || !def.active) return s;

  const attacker = atk.active;
  const defender = def.active;

  // 攻撃不可チェック（cantAttackUntilTurn >= 現在ターンなら攻撃不可）
  if (attacker.cantAttackUntilTurn >= s.turn) {
    addLog(s, `${attacker.name} は攻撃できない（前ターンの効果）`);
    return s;
  }

  const card = getCardData(s, attacker.cardId);
  const attack = card?.attacks[attackIndex];
  if (!attack) return s;

  if (!canUseAttack(attacker, attack)) {
    addLog(s, `エネルギーが足りない: ${attack.name}`);
    return s;
  }

  // ダメージ計算（効果による倍率上書き含む）
  let damage = calcAttackDamage(s, atkPi, attack);
  damage = applyWeaknessResistance(damage, attacker, defender, s);

  dealDamage(defender, damage, s);
  addLog(s, `${attacker.name} の ${attack.name}！ → ${defender.name} に ${damage}ダメージ（残HP: ${defender.currentHp}）`);

  // ワザテキスト効果
  if (attack.text) {
    applyAttackEffect(s, atkPi, attack.text, attack.name, damage);
  }

  // きぜつチェック（テキスト効果でさらにきぜつした場合も含め再チェック）
  if (defender.currentHp <= 0) {
    handleKnockout(s, def, atk, defender);
  }

  // ベンチのきぜつチェック（Phantom Dive等）
  for (let i = 0; i < def.bench.length; i++) {
    const b = def.bench[i];
    if (b && b.currentHp <= 0) {
      const prizes = b.isEx ? 2 : 1;
      atk.prizesTaken += prizes;
      const taken = def.prizes.splice(0, prizes);
      atk.hand.push(...taken);
      addLog(s, `${b.name} がベンチできぜつ！ サイド${prizes}枚`);
      def.bench[i] = null;
    }
  }

  s.phase = 'between-turns';
  return s;
}

// ===== ダメージ・きぜつ =====

export function dealDamage(target: ActivePokemon, damage: number, state: GameState): void {
  target.currentHp = Math.max(0, target.currentHp - damage);
}

export function handleKnockout(
  state:         GameState,
  losingPlayer:  PlayerState,
  winningPlayer: PlayerState,
  ko:            ActivePokemon,
): void {
  const prizes = ko.isEx ? 2 : 1;
  addLog(state, `${ko.name} がきぜつ！ サイドを${prizes}枚取る`);

  // 自分のサイドカードを取る（正しいルール）
  const taken = winningPlayer.prizes.splice(0, prizes);
  winningPlayer.prizesTaken += prizes;
  winningPlayer.hand.push(...taken);

  // ツールカードをトラッシュ
  if (ko.toolCard) losingPlayer.discard.push(ko.toolCard);
  // エネルギーをトラッシュ
  losingPlayer.discard.push(...ko.energies.map(e => ({ supertype: 'Energy', types: [e] } as any)));

  // ベンチから昇格
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

  const card = getCardData(s, p.active.cardId);
  const cost = card?.retreatCost?.length ?? 0;
  if (p.active.energies.length < cost) {
    addLog(s, 'にげるエネルギーが足りない'); return s;
  }
  for (let i = 0; i < cost; i++) {
    const e = p.active.energies.pop()!;
    p.discard.push({ supertype: 'Energy', types: [e] } as any);
  }

  const tmp = p.active;
  p.active = p.bench[benchSlot]!;
  p.bench[benchSlot] = tmp;
  addLog(s, `${p.active.name} がバトル場に出た`);
  return s;
}

// ===== 勝敗判定 =====

export function checkWinCondition(state: GameState): Winner {
  const [p0, p1] = state.players;

  if (p0.prizesTaken >= 6) return 0;
  if (p1.prizesTaken >= 6) return 1;

  if (p0.deck.length === 0 && state.activePlayer === 0) return 1;
  if (p1.deck.length === 0 && state.activePlayer === 1) return 0;

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
      if (Math.random() < 0.5) {
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
  for (const needed of attack.cost) {
    if (needed === 'Colorless') continue;
    // プリズムエネルギー（Colorless として格納）は全タイプ対応（基本ポケモン限定だが近似）
    const idx = available.indexOf(needed);
    if (idx === -1) {
      const prismIdx = available.indexOf('Colorless');
      if (prismIdx === -1) return false;
      available.splice(prismIdx, 1);
    } else {
      available.splice(idx, 1);
    }
  }
  const colorlessCost = attack.cost.filter(c => c === 'Colorless').length;
  return available.length >= colorlessCost;
}

export function inferEnergyType(card: CardData): string {
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
  // プリズムエネルギー等の特殊エネルギー: Colorless として扱う（canUseAttackでフォロー）
  return 'Colorless';
}

function applyWeaknessResistance(
  damage:   number,
  attacker: ActivePokemon,
  defender: ActivePokemon,
  state:    GameState,
): number {
  const defCard = getCardData(state, defender.cardId);
  if (!defCard) return damage;

  const atkCard = getCardData(state, attacker.cardId);
  const atkType = atkCard?.types[0];
  if (!atkType) return damage;

  // リーリエのピッピex Fairy Zone アビリティ: ドラゴンの弱点がサイキックになる
  const weakness = defCard.weaknesses.find(w => {
    if (w.type === atkType) return true;
    // ドラゴン弱点のFairy Zone適用
    if (w.type === 'Fairy' && atkType === 'Psychic') return true;
    return false;
  });
  if (weakness) damage *= 2;

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

export function addLog(state: GameState, msg: string): void {
  state.log.push(msg);
}

let _cardDb: Record<string, any> = {};
export function setCardDb(db: Record<string, any>): void { _cardDb = db; }
export function getCardData(state: GameState, id: string): any {
  return _cardDb[id] ?? null;
}
