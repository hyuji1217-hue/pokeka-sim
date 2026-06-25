/**
 * ai-player.ts — ヒューリスティックAI（人間レベル相当）
 *
 * chooseAction() が1つのActionを返す。simulator.tsのループから繰り返し呼ばれる。
 */
import type {
  GameState, PlayerState, PlayerIndex, Action, ActivePokemon, CardData,
} from './types.js';
import {
  isBasicPokemon, canUseAttack, parseDamage, getCardData,
} from './game-engine.js';
import { calcAttackDamage } from './effects.js';

// ===== メインエントリ =====

export function chooseAction(state: GameState, pi: PlayerIndex): Action {
  const me  = state.players[pi];
  const opp = state.players[pi === 0 ? 1 : 0];

  // ── セットアップ: バトル場にポケモンを出す ──
  if (me.active === null) {
    const idx = me.hand.findIndex(isBasicPokemon);
    if (idx >= 0) return { type: 'play-pokemon', cardIndex: idx };
    return { type: 'end-turn' };
  }

  // ── 1. KOできるワザがあれば攻撃（cantAttackUntilTurn チェック） ──
  if (!state.firstTurn && me.active.cantAttackUntilTurn < state.turn) {
    const koAtk = findKOAttack(me, opp, state, pi);
    if (koAtk !== null) return { type: 'attack', attackIndex: koAtk };
  }

  // ── 2. ボスの指令: 相手ベンチにKOできる低HPポケモンがいれば使う ──
  if (!me.supporterPlayedThisTurn) {
    const bossIdx = findInHand(me, c => c.name.startsWith("Boss's Orders") || c.name.startsWith("ボスの指令"));
    if (bossIdx >= 0) {
      const targetSlot = findKillableOppBench(me, opp, state, pi);
      if (targetSlot >= 0) {
        return { type: 'play-trainer', cardIndex: bossIdx, trainerTarget: targetSlot };
      }
    }
  }

  // ── 3. 進化（優先度: より進んだ進化が先） ──
  const evolAction = chooseBestEvolve(state, pi);
  if (evolAction) return evolAction;

  // ── 4. ハイパーボール: 必要なポケモンがデッキにあり手札に2枚余裕がある ──
  const ultraBallIdx = findInHand(me, c => c.name === 'Ultra Ball');
  if (ultraBallIdx >= 0 && me.hand.length >= 3 && me.deck.some(c => c.supertype === 'Pokémon')) {
    const discards = chooseTwoToDiscard(me, ultraBallIdx);
    if (discards.length >= 2) {
      return { type: 'play-trainer', cardIndex: ultraBallIdx, discardIndices: discards };
    }
  }

  // ── 5. なかよしポフィン: ベンチに空きあり ──
  if (me.bench.some(b => b === null)) {
    const poffinIdx = findInHand(me, c => c.name === 'Buddy-Buddy Poffin');
    if (poffinIdx >= 0) {
      return { type: 'play-trainer', cardIndex: poffinIdx };
    }
  }

  // ── 6. ベンチ展開（基本ポケモン）──
  if (me.bench.some(b => b === null)) {
    const basicIdx = me.hand.findIndex(isBasicPokemon);
    if (basicIdx >= 0) {
      return { type: 'play-pokemon', cardIndex: basicIdx };
    }
  }

  // ── 7. エネルギーをつける（1ターン1枚。進化先が必要とするタイプを優先）──
  if (!me.energyAttachedThisTurn) {
    const energyAction = chooseBestEnergyAttach(me, state, pi);
    if (energyAction) return energyAction;
  }

  // ── 8. サポートカード（手札補充系）──
  if (!me.supporterPlayedThisTurn) {
    const suppAction = chooseSupportCard(state, pi);
    if (suppAction) return suppAction;
  }

  // ── 9. グッズ（夜のタンカ・ポケパッド・暗号マニアの解読等）──
  const itemAction = chooseItemCard(state, pi);
  if (itemAction) return itemAction;

  // ── 10. 道具カード装着 ──
  const toolAction = chooseToolCard(state, pi);
  if (toolAction) return toolAction;

  // ── 11. スタジアム ──
  const stadiumAction = chooseStadiumCard(state, pi);
  if (stadiumAction) return stadiumAction;

  // ── 12. 攻撃（ダメージが出るワザなら攻撃）──
  if (!state.firstTurn && me.active.cantAttackUntilTurn < state.turn) {
    const anyAtk = findBestAttack(me, opp, state, pi);
    if (anyAtk !== null) return { type: 'attack', attackIndex: anyAtk };
  }

  // ── 13. にげる（バトル場が不利で体力が低い）──
  const retreatAction = chooseRetreat(state, pi);
  if (retreatAction) return retreatAction;

  return { type: 'end-turn' };
}

// ===== 進化判断 =====

function chooseBestEvolve(state: GameState, pi: PlayerIndex): Action | null {
  if (state.firstTurn) return null;
  const me = state.players[pi];

  // 全ポケモン（アクティブ + ベンチ）について進化できるものを探す
  const candidates: { evolCard: CardData; handIdx: number; slot: number; stage: number }[] = [];

  const checkPokemon = (pokemon: ActivePokemon | null, slot: number) => {
    if (!pokemon || pokemon.evolveBlocked) return;
    for (let hi = 0; hi < me.hand.length; hi++) {
      const card = me.hand[hi];
      if (card.supertype !== 'Pokémon') continue;
      const targetCard = getCardData(state, pokemon.cardId);
      if (card.evolvesFrom === targetCard?.name) {
        // ステージ判定（Stage 2が優先）
        const stage = card.subtypes.includes('Stage 2') ? 2
                    : card.subtypes.includes('Stage 1') ? 1 : 0;
        candidates.push({ evolCard: card, handIdx: hi, slot, stage });
      }
    }
  };

  checkPokemon(me.active, -1);
  for (let i = 0; i < me.bench.length; i++) checkPokemon(me.bench[i], i);

  if (candidates.length === 0) return null;
  // ステージが高い方を優先
  candidates.sort((a, b) => b.stage - a.stage);
  const best = candidates[0];
  return { type: 'evolve', cardIndex: best.handIdx, targetSlot: best.slot };
}

// ===== KO攻撃判断 =====

function findKOAttack(
  me: PlayerState, opp: PlayerState,
  state: GameState, pi: PlayerIndex,
): number | null {
  if (!me.active || !opp.active) return null;
  const card = getCardData(state, me.active.cardId);
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

// ===== 最大ダメージ攻撃 =====

function findBestAttack(
  me: PlayerState, opp: PlayerState,
  state: GameState, pi: PlayerIndex,
): number | null {
  if (!me.active || !opp.active) return null;
  const card = getCardData(state, me.active.cardId);
  if (!card) return null;

  let bestIdx = -1, bestDmg = -1;
  for (let i = 0; i < card.attacks.length; i++) {
    const atk = card.attacks[i];
    if (!canUseAttack(me.active, atk)) continue;
    const dmg = calcAttackDamage(state, pi, atk);
    if (dmg > 0 && dmg > bestDmg) { bestDmg = dmg; bestIdx = i; }
  }
  return bestIdx >= 0 ? bestIdx : null;
}

// ===== ボスの指令のターゲット選択 =====

function findKillableOppBench(
  me: PlayerState, opp: PlayerState,
  state: GameState, pi: PlayerIndex,
): number {
  if (!me.active) return -1;
  const card = getCardData(state, me.active.cardId);
  if (!card) return -1;

  let bestDmg = 0;
  let bestAtk = -1;
  for (let i = 0; i < card.attacks.length; i++) {
    const atk = card.attacks[i];
    if (!canUseAttack(me.active, atk)) continue;
    const dmg = calcAttackDamage(state, pi, atk);
    if (dmg > bestDmg) { bestDmg = dmg; bestAtk = i; }
  }
  if (bestAtk < 0 || bestDmg === 0) return -1;

  // ベンチでKOできる（かつHPが一番低い）ポケモンを選ぶ
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

// ===== エネルギー付け先選択 =====

function chooseBestEnergyAttach(
  me: PlayerState, state: GameState, pi: PlayerIndex,
): Action | null {
  const energyIdx = me.hand.findIndex(c => c.supertype === 'Energy');
  if (energyIdx < 0) return null;

  const energyCard = me.hand[energyIdx];
  const energyType = inferEnergyType(energyCard);

  // アクティブポケモンに付けるべきか判断
  // 基準: アクティブが一番エネルギーを必要としているなら付ける
  if (me.active) {
    const card = getCardData(state, me.active.cardId);
    if (card && card.attacks.length > 0) {
      // 次のワザを使えるようになるか確認
      const neededTypes = card.attacks[0].cost;
      const wouldHelp = neededTypes.some(t => t === energyType || t === 'Colorless');
      if (wouldHelp) {
        return { type: 'attach-energy', cardIndex: energyIdx, targetSlot: -1 };
      }
    }
    // とにかくアクティブに付ける（デフォルト）
    return { type: 'attach-energy', cardIndex: energyIdx, targetSlot: -1 };
  }

  // ベンチに付ける
  const benchSlot = me.bench.findIndex(b => b !== null);
  if (benchSlot >= 0) {
    return { type: 'attach-energy', cardIndex: energyIdx, targetSlot: benchSlot };
  }

  return null;
}

// ===== サポートカード選択 =====

function chooseSupportCard(state: GameState, pi: PlayerIndex): Action | null {
  const me = state.players[pi];
  if (me.supporterPlayedThisTurn) return null;

  // ナンジャモ: 手札が少ない（< 4）またはサイド差が大きいとき
  const ionoIdx = findInHand(me, c => c.name === 'Iono');
  if (ionoIdx >= 0 && me.hand.length <= 4) {
    return { type: 'play-trainer', cardIndex: ionoIdx };
  }

  // リーリエの決心: 手札が少ない（< 5）
  const lillieIdx = findInHand(me, c => c.name.includes("Lillie's Determination") || c.name.includes('リーリエの決心'));
  if (lillieIdx >= 0 && me.hand.length <= 5) {
    return { type: 'play-trainer', cardIndex: lillieIdx };
  }

  // アカマツ: 手札が少ない（< 4）
  const nemonaIdx = findInHand(me, c => c.name === 'Nemona' || c.name === 'アカマツ');
  if (nemonaIdx >= 0 && me.hand.length <= 4) {
    return { type: 'play-trainer', cardIndex: nemonaIdx };
  }

  // 暗号マニアの解読: 手札が少ない（< 4）
  const cipherIdx = findInHand(me, c => c.name === "Ciphermaniac's Codebreaking");
  if (cipherIdx >= 0 && me.hand.length <= 4) {
    return { type: 'play-trainer', cardIndex: cipherIdx };
  }

  // Nの筋書き / N's Plan: ベンチにエネルギーがあり、アクティブが足りないとき使う
  const nIdx = findInHand(me, c => c.name === "N's Plan" || c.name.includes('Nの筋書き'));
  if (nIdx >= 0 && me.active) {
    const benchHasEnergy = me.bench.some(b => b && b.energies.length > 0);
    const activeNeedsEnergy = me.active.energies.length < 3; // 大体3枚以下なら使う
    if (benchHasEnergy && activeNeedsEnergy) {
      return { type: 'play-trainer', cardIndex: nIdx };
    }
  }

  // スペシャルレッドカード: 終盤（サイド3以下）に使う
  const redIdx = findInHand(me, c => c.name.includes('Red Card') || c.name.includes('レッドカード'));
  if (redIdx >= 0 && me.prizes.length <= 3) {
    return { type: 'play-trainer', cardIndex: redIdx };
  }

  // アンフェアスタンプ: 相手サイド有利時
  const stampIdx = findInHand(me, c => c.name.includes('Unfair Stamp') || c.name.includes('アンフェアスタンプ'));
  if (stampIdx >= 0) {
    const opp = state.players[pi === 0 ? 1 : 0];
    if (opp.prizes.length <= 4) {
      return { type: 'play-trainer', cardIndex: stampIdx };
    }
  }

  return null;
}

// ===== グッズカード選択 =====

function chooseItemCard(state: GameState, pi: PlayerIndex): Action | null {
  const me = state.players[pi];

  // 夜のタンカ: トラッシュに有用なポケモン・エネルギーがある
  const ntIdx = findInHand(me, c => c.name === 'Night Stretcher');
  if (ntIdx >= 0) {
    const hasUsefulInDiscard = me.discard.some(c => c.supertype === 'Pokémon' || c.supertype === 'Energy');
    if (hasUsefulInDiscard) {
      return { type: 'play-trainer', cardIndex: ntIdx };
    }
  }

  // ポケパッド: トラッシュにサポートがある
  const palIdx = findInHand(me, c => c.name === 'Pal Pad');
  if (palIdx >= 0 && me.discard.some(c => c.subtypes.includes('Supporter'))) {
    return { type: 'play-trainer', cardIndex: palIdx };
  }

  // エネルギーつけかえ: ベンチにエネルギーがあり、アクティブに移したい
  const eneSwIdx = findInHand(me, c => c.name.includes('つけかえ') || c.name.includes('Switch') || c.name.includes('Transfer'));
  if (eneSwIdx >= 0 && me.active) {
    const card = getCardData(state, me.active.cardId);
    if (card && !canUseAnyAttack(me, card, pi, state)) {
      if (me.bench.some(b => b && b.energies.length > 0)) {
        return { type: 'play-trainer', cardIndex: eneSwIdx };
      }
    }
  }

  // むしとりセット: ベンチに空きあり
  const bugIdx = findInHand(me, c => c.name.includes('むしとり') || c.name.includes('Bug Catching'));
  if (bugIdx >= 0 && me.bench.some(b => b === null)) {
    return { type: 'play-trainer', cardIndex: bugIdx };
  }

  return null;
}

// ===== 道具カード選択 =====

function chooseToolCard(state: GameState, pi: PlayerIndex): Action | null {
  const me = state.players[pi];
  const toolIdx = findInHand(me, c => c.subtypes.includes('Pokémon Tool') || c.subtypes.includes('Tool'));
  if (toolIdx < 0) return null;

  // アクティブポケモンに道具がなければ付ける
  if (me.active && !me.active.toolCard) {
    return { type: 'play-trainer', cardIndex: toolIdx, trainerTarget: -1 };
  }
  // ベンチのHPが高いポケモンに付ける
  let bestSlot = -1, bestHp = -1;
  for (let i = 0; i < me.bench.length; i++) {
    const b = me.bench[i];
    if (b && !b.toolCard && b.maxHp > bestHp) { bestHp = b.maxHp; bestSlot = i; }
  }
  if (bestSlot >= 0) {
    return { type: 'play-trainer', cardIndex: toolIdx, trainerTarget: bestSlot };
  }
  return null;
}

// ===== スタジアム選択 =====

function chooseStadiumCard(state: GameState, pi: PlayerIndex): Action | null {
  const me = state.players[pi];
  const stadIdx = findInHand(me, c => c.subtypes.includes('Stadium'));
  if (stadIdx < 0) return null;
  // スタジアムが場になければ出す
  if (!me.stadium) {
    return { type: 'play-trainer', cardIndex: stadIdx };
  }
  return null;
}

// ===== にげる選択 =====

function chooseRetreat(state: GameState, pi: PlayerIndex): Action | null {
  const me = state.players[pi];
  if (!me.active) return null;

  const card = getCardData(state, me.active.cardId);
  const cost = card?.retreatCost?.length ?? 0;

  // HPが残り30以下かつベンチに高HPポケモンがいれば退場
  if (me.active.currentHp <= 30 && me.active.energies.length >= cost) {
    const bestBench = findBestBenchSlot(me);
    if (bestBench >= 0 && (me.bench[bestBench]?.maxHp ?? 0) > me.active.currentHp) {
      return { type: 'retreat', targetSlot: bestBench };
    }
  }
  return null;
}

// ===== ユーティリティ =====

function findInHand(me: PlayerState, pred: (c: CardData) => boolean): number {
  return me.hand.findIndex(pred);
}

function findBestBenchSlot(me: PlayerState): number {
  let best = -1, bestHp = -1;
  for (let i = 0; i < me.bench.length; i++) {
    const b = me.bench[i];
    if (b && b.currentHp > bestHp) { bestHp = b.currentHp; best = i; }
  }
  return best;
}

function chooseTwoToDiscard(me: PlayerState, excludeIdx: number): number[] {
  // エネルギーカード・使えないポケモン（進化先がない等）を捨て対象に
  const idxs: number[] = [];
  for (let i = 0; i < me.hand.length && idxs.length < 2; i++) {
    if (i === excludeIdx) continue;
    const c = me.hand[i];
    if (c.supertype === 'Energy') idxs.push(i);
  }
  for (let i = 0; i < me.hand.length && idxs.length < 2; i++) {
    if (i === excludeIdx || idxs.includes(i)) continue;
    idxs.push(i);
  }
  return idxs;
}

function canUseAnyAttack(me: PlayerState, card: any, pi: PlayerIndex, state: GameState): boolean {
  if (!me.active) return false;
  for (const atk of (card.attacks ?? [])) {
    if (canUseAttack(me.active, atk) && calcAttackDamage(state, pi, atk) > 0) return true;
  }
  return false;
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

function applyWeaknessResistanceEst(
  damage:   number,
  attacker: ActivePokemon,
  defender: ActivePokemon,
  state:    GameState,
): number {
  const defCard = getCardData(state, defender.cardId);
  if (!defCard) return damage;
  const atkCard = getCardData(state, attacker.cardId);
  const atkType = atkCard?.types?.[0];
  if (!atkType) return damage;

  const weakness = defCard.weaknesses?.find((w: any) => w.type === atkType);
  if (weakness) damage *= 2;
  const resist = defCard.resistances?.find((r: any) => r.type === atkType);
  if (resist) damage = Math.max(0, damage - 30);
  return damage;
}

export function canRetreat(pokemon: ActivePokemon, cost: number): boolean {
  return pokemon.energies.length >= cost;
}
