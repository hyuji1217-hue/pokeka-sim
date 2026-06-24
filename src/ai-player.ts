/**
 * ai-player.ts — ヒューリスティックAIプレイヤー（骨格）
 *
 * 1ヶ月後にデッキが確定したらchooseAction()内の優先度ロジックを肉付けする。
 * 現時点では「動くが賢くない」最低限の実装。
 */

import {
  GameState, PlayerState, PlayerIndex, Action, ActivePokemon, CardData,
} from './types.js';
import {
  isBasicPokemon, canUseAttack, parseDamage, getCardData,
} from './game-engine.js';

// ===== メインエントリ =====

/**
 * 現在の盤面から最善と思われるActionを1つ返す。
 * ターン内で何度も呼ばれ、end-turn を返すまで繰り返す。
 */
export function chooseAction(state: GameState, playerIndex: PlayerIndex): Action {
  const me    = state.players[playerIndex];
  const opp   = state.players[playerIndex === 0 ? 1 : 0];

  // ── セットアップフェーズ：バトル場にポケモンを出す ──
  if (me.active === null) {
    const basicIdx = me.hand.findIndex(c => isBasicPokemon(c));
    if (basicIdx >= 0) return { type: 'play-pokemon', cardIndex: basicIdx, targetSlot: -1 };
    return { type: 'end-turn' }; // 出せるポケモンがない（理論上ここには来ない）
  }

  // ── メインフェーズ：優先度順にアクションを選択 ──

  // 1. KOできるワザがあれば攻撃
  const koAttack = findKOAttack(me, opp, state);
  if (koAttack !== null && state.phase === 'main' && !state.firstTurn) {
    return { type: 'attack', attackIndex: koAttack };
  }

  // 2. ベンチを展開（空きがあり、手札にベーシックがある）
  if (me.bench.some(b => b === null)) {
    const basicIdx = me.hand.findIndex(c => isBasicPokemon(c));
    if (basicIdx >= 0) {
      const slot = me.bench.findIndex(b => b === null);
      return { type: 'play-pokemon', cardIndex: basicIdx, targetSlot: slot };
    }
  }

  // 3. バトルポケモンにエネルギーをつける
  const energyIdx = me.hand.findIndex(c => c.supertype === 'Energy');
  if (energyIdx >= 0 && me.active !== null) {
    return { type: 'attach-energy', cardIndex: energyIdx, targetSlot: -1 };
  }

  // 4. ダメージが出せるワザで攻撃（KOでなくてもダメージを与える）
  const anyAttack = findBestAttack(me, opp, state);
  if (anyAttack !== null && state.phase === 'main' && !state.firstTurn) {
    return { type: 'attack', attackIndex: anyAttack };
  }

  // 5. それ以外：ターン終了
  return { type: 'end-turn' };
}

// ===== KO判定 =====

function findKOAttack(
  me: PlayerState,
  opp: PlayerState,
  state: GameState,
): number | null {
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

// ===== 最大ダメージのワザを選ぶ =====

function findBestAttack(
  me: PlayerState,
  opp: PlayerState,
  state: GameState,
): number | null {
  if (!me.active || !opp.active) return null;
  const card = getCardData(state, me.active.cardId);
  if (!card) return null;

  let bestIdx = -1;
  let bestDmg = -1;

  for (let i = 0; i < card.attacks.length; i++) {
    const atk = card.attacks[i];
    if (!canUseAttack(me.active, atk)) continue;
    const dmg = estimateDamage(atk, me.active, opp.active, state);
    if (dmg > 0 && dmg > bestDmg) { bestDmg = dmg; bestIdx = i; }
  }

  return bestIdx >= 0 ? bestIdx : null;
}

// ===== ダメージ推定（カード効果なしの基本値） =====
// 1ヶ月後にカード効果を実装したらここを拡張する

function estimateDamage(
  attack:   { damage: string; cost: string[] },
  attacker: ActivePokemon,
  defender: ActivePokemon,
  state:    GameState,
): number {
  let dmg = parseDamage(attack.damage);

  // 弱点（×2）
  const atkCard = getCardData(state, attacker.cardId);
  const defCard = getCardData(state, defender.cardId);
  if (atkCard && defCard) {
    const atkType = atkCard.types?.[0];
    const weakness = defCard.weaknesses?.find((w: any) => w.type === atkType);
    if (weakness) dmg *= 2;
    const resist = defCard.resistances?.find((r: any) => r.type === atkType);
    if (resist) dmg = Math.max(0, dmg - 30);
  }

  return dmg;
}

// ===== ユーティリティ =====

/** にげるコストを払えるか */
export function canRetreat(pokemon: ActivePokemon, cost: number): boolean {
  return pokemon.energies.length >= cost;
}

/** ベンチで一番HPが高いポケモンのスロット番号 */
export function bestBenchSlot(bench: (ActivePokemon | null)[]): number {
  let best = -1;
  let bestHp = -1;
  for (let i = 0; i < bench.length; i++) {
    const b = bench[i];
    if (b && b.currentHp > bestHp) { bestHp = b.currentHp; best = i; }
  }
  return best;
}
