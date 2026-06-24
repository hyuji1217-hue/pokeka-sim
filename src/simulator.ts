/**
 * simulator.ts — シミュレーション実行基盤
 * デッキAとデッキBを N回対戦させて勝率を返す。
 */

import {
  GameState, CardData, PlayerIndex, SimResult, Action,
} from './types.js';
import {
  initGame, startTurn, endTurn, useAttack, attachEnergy,
  playBasicToActive, evolvePokemon, retreat, checkWinCondition,
  setCardDb,
} from './game-engine.js';
import { chooseAction } from './ai-player.js';

const MAX_TURNS = 200; // 無限ループ防止（30は低すぎて引き分け多発）

// ===== 1ゲーム実行 =====

export function runGame(
  deckA: CardData[],
  deckB: CardData[],
  firstPlayer: PlayerIndex = 0,
  verbose = false,
): SimResult {
  let state = initGame(deckA, deckB);
  state.activePlayer = firstPlayer;

  // セットアップ：バトル場にポケモンを置く
  state = setupPhase(state);

  let totalTurns = 0;

  while (state.winner === null && totalTurns < MAX_TURNS) {
    state = startTurn(state);

    // メインフェーズ：AIがアクションを繰り返す
    let actionCount = 0;
    const MAX_ACTIONS = 20; // 1ターン内の最大アクション数

    while (actionCount < MAX_ACTIONS) {
      const action = chooseAction(state, state.activePlayer);
      state = applyAction(state, action);
      if (action.type === 'end-turn' || action.type === 'attack') break;
      actionCount++;
    }

    // ターン終了
    state = endTurn(state);
    totalTurns++;
  }

  const winner = state.winner ?? 'draw';

  return {
    winner: winner === 'draw' ? 'draw' : winner,
    turns:  totalTurns,
    log:    verbose ? state.log : undefined,
  };
}

// ===== セットアップフェーズ =====

function setupPhase(state: GameState): GameState {
  let s = { ...state };
  // 両プレイヤーがバトル場にポケモンを置く
  for (const pi of [0, 1] as PlayerIndex[]) {
    let actionCount = 0;
    while (s.players[pi].active === null && actionCount < 10) {
      const action = chooseAction({ ...s, activePlayer: pi }, pi);
      s = applyAction(s, { ...action });
      s.activePlayer = pi; // setupは両プレイヤーが同時に行動
      actionCount++;
    }
  }
  s.phase = 'main';
  return s;
}

// ===== アクション適用 =====

function applyAction(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'play-pokemon':
      return playBasicToActive(state, action.cardIndex ?? 0);
    case 'attach-energy':
      return attachEnergy(state, action.cardIndex ?? 0, action.targetSlot ?? -1);
    case 'attack':
      return useAttack(state, action.attackIndex ?? 0);
    case 'retreat':
      return retreat(state, action.targetSlot ?? 0);
    case 'end-turn':
    default:
      return state;
  }
}

// ===== N回シミュレーション =====

export interface SimSummary {
  iterations:  number;
  winRateA:    number;   // % (0-100)
  winRateB:    number;
  drawRate:    number;
  avgTurns:    number;
  winsA:       number;
  winsB:       number;
  draws:       number;
}

export async function runSimulation(
  deckA:      CardData[],
  deckB:      CardData[],
  iterations: number = 1000,
  onProgress?: (done: number, total: number) => void,
): Promise<SimSummary> {
  let winsA = 0, winsB = 0, draws = 0, totalTurns = 0;

  for (let i = 0; i < iterations; i++) {
    // 先後を交互に入れ替え（公平性のため）
    const firstPlayer = (i % 2 === 0 ? 0 : 1) as PlayerIndex;
    const result = runGame(deckA, deckB, firstPlayer);

    if (result.winner === 0)    winsA++;
    else if (result.winner === 1) winsB++;
    else                          draws++;

    totalTurns += result.turns;

    if (onProgress && i % 100 === 0) onProgress(i, iterations);

    // UIブロッキング防止（ブラウザ用）
    if (i % 200 === 0) await new Promise(r => setTimeout(r, 0));
  }

  return {
    iterations,
    winRateA:  Math.round(winsA / iterations * 1000) / 10,
    winRateB:  Math.round(winsB / iterations * 1000) / 10,
    drawRate:  Math.round(draws / iterations * 1000) / 10,
    avgTurns:  Math.round(totalTurns / iterations * 10) / 10,
    winsA, winsB, draws,
  };
}

// ===== 初期化（cards.jsonを渡す） =====

export function initSimulator(cardDb: Record<string, CardData>): void {
  setCardDb(cardDb);
}
