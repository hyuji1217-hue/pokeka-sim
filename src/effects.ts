/**
 * effects.ts — カード個別効果（トレーナー・ワザ）
 * ゲームエンジンから呼び出す。カードIDまたはカード名でディスパッチ。
 */
import type { GameState, PlayerIndex, CardData, ActivePokemon } from './types.js';
import { drawCards, dealDamage, handleKnockout, addLog, clone, shuffle, isBasicPokemon, inferEnergyType, getCardData } from './game-engine.js';

// ===== トレーナー効果 =====

/**
 * トレーナーカードの効果を適用する。
 * @returns 効果適用後のstate（効果不明/対象なしの場合は変更なし）
 */
export function applyTrainerEffect(
  state:    GameState,
  pi:       PlayerIndex,
  card:     CardData,
  target?:  number,          // ボスの指令等: 相手ベンチスロット
  discards?: number[],       // ハイパーボール: 捨てるカードインデックス
): GameState {
  const s = clone(state);
  const me  = s.players[pi];
  const opp = s.players[pi === 0 ? 1 : 0];

  const name = card.name;
  const text = (card.rules ?? []).join(' ');

  // ── ハイパーボール / Ultra Ball ──
  if (name === 'Ultra Ball' || text.includes('discard 2 other cards')) {
    // 手札から2枚捨てる → デッキからポケモン1枚をサーチして手札へ
    const idxs = discards ?? [];
    if (idxs.length >= 2) {
      // 大きいインデックスから削除（インデックスズレ防止）
      const sorted = [...idxs].sort((a, b) => b - a);
      for (const i of sorted) {
        const c = me.hand.splice(i, 1)[0];
        if (c) me.discard.push(c);
      }
    }
    // AIが選んだポケモンをサーチ（target = deck index、-1で最初のポケモン）
    const pIdx = me.deck.findIndex(c => c.supertype === 'Pokémon');
    if (pIdx >= 0) {
      const found = me.deck.splice(pIdx, 1)[0];
      me.hand.push(found);
      me.deck = shuffle(me.deck);
      addLog(s, `ハイパーボール: ${found.name} をサーチ`);
    } else {
      addLog(s, `ハイパーボール: ポケモンが見つからない`);
    }
    return s;
  }

  // ── なかよしポフィン / Buddy-Buddy Poffin ──
  if (name === 'Buddy-Buddy Poffin' || text.includes('70 HP or less')) {
    const targets = me.deck.filter(c => isBasicPokemon(c) && (c.hp ?? 0) <= 70);
    shuffle(targets);
    const placed = targets.slice(0, 2);
    for (const p of placed) {
      const slot = me.bench.findIndex(b => b === null);
      if (slot < 0) break;
      const idx = me.deck.findIndex(c => c.id === p.id);
      if (idx >= 0) {
        const popped = me.deck.splice(idx, 1)[0];
        me.bench[slot] = makeBenchPokemon(popped, s.turn);
        addLog(s, `なかよしポフィン: ${popped.name} をベンチに`);
      }
    }
    me.deck = shuffle(me.deck);
    return s;
  }

  // ── ボスの指令 / Boss's Orders ──
  if (name.startsWith("Boss's Orders") || text.includes('Switch in 1 of your opponent')) {
    const slot = target ?? oppBestTargetSlot(opp.bench);
    if (slot >= 0 && opp.bench[slot] !== null) {
      const tmp = opp.active;
      opp.active = opp.bench[slot]!;
      if (tmp) opp.bench[slot] = tmp;
      else opp.bench[slot] = null;
      addLog(s, `ボスの指令: ${opp.active.name} がバトル場へ`);
    }
    return s;
  }

  // ── ナンジャモ / Iono ──
  if (name === 'Iono' || text.includes('Prize cards')) {
    const meCount  = me.prizes.length;
    const oppCount = opp.prizes.length;
    me.deck.push(...me.hand);
    me.deck = shuffle(me.deck);
    me.hand = [];
    drawCards(me, meCount, s);
    opp.deck.push(...opp.hand);
    opp.deck = shuffle(opp.deck);
    opp.hand = [];
    drawCards(opp, oppCount, s);
    addLog(s, `ナンジャモ: 両者手札リセット（${meCount}枚 / ${oppCount}枚）`);
    return s;
  }

  // ── アカマツ / Nemona ──
  if (name === 'Nemona' || text.includes('Draw 3 cards')) {
    drawCards(me, 3, s);
    addLog(s, `アカマツ: 3枚ドロー`);
    return s;
  }

  // ── 暗号マニアの解読 / Ciphermaniac's Codebreaking ──
  if (name === "Ciphermaniac's Codebreaking" || text.includes('top of it in any order')) {
    const found: CardData[] = [];
    for (let i = 0; i < 2 && me.deck.length > 0; i++) {
      const idx = me.deck.length > 1
        ? me.deck.findIndex(c => c.supertype === 'Pokémon') >= 0
          ? me.deck.findIndex(c => c.supertype === 'Pokémon')
          : 0
        : 0;
      found.push(me.deck.splice(idx, 1)[0]);
    }
    me.deck = shuffle(me.deck);
    for (const c of found.reverse()) me.deck.unshift(c);
    addLog(s, `暗号マニアの解読: 2枚をデッキトップに`);
    return s;
  }

  // ── 夜のタンカ / Night Stretcher ──
  if (name === 'Night Stretcher' || text.includes('discard pile into your hand')) {
    // 優先順位: ポケモン > エネルギー（AIが最も使えるものを取る）
    const pIdx = me.discard.findIndex(c => c.supertype === 'Pokémon');
    const eIdx = me.discard.findIndex(c => c.supertype === 'Energy');
    const chosen = pIdx >= 0 ? pIdx : eIdx;
    if (chosen >= 0) {
      const recovered = me.discard.splice(chosen, 1)[0];
      me.hand.push(recovered);
      addLog(s, `夜のタンカ: ${recovered.name} を回収`);
    }
    return s;
  }

  // ── ポケパッド / Pal Pad ──
  if (name === 'Pal Pad' || text.includes('Supporter cards from your discard')) {
    let count = 0;
    for (let i = me.discard.length - 1; i >= 0 && count < 2; i--) {
      const c = me.discard[i];
      if (c.subtypes.includes('Supporter')) {
        me.discard.splice(i, 1);
        me.deck.push(c);
        count++;
      }
    }
    me.deck = shuffle(me.deck);
    addLog(s, `ポケパッド: サポート${count}枚をデッキに戻す`);
    return s;
  }

  // ── ヒーローマント / Hero's Cape (Pokémon Tool) ──
  if (name === "Hero's Cape" || text.includes('+100 HP') || text.includes('100 HP')) {
    const pokemon = target === -1 ? me.active : me.bench[target ?? 0];
    if (pokemon && !pokemon.toolCard) {
      pokemon.toolCard = card;
      pokemon.maxHp += 100;
      pokemon.currentHp = Math.min(pokemon.currentHp + 100, pokemon.maxHp);
      addLog(s, `ヒーローマント: ${pokemon.name} のHPが+100`);
    }
    return s;
  }

  // ── エネルギーつけかえ / Energy Switch ──
  if (name.includes('Energy') && (text.includes('Move') || name.includes('Switch') || name.includes('Transfer') || name.includes('つけかえ'))) {
    // 自分のベンチポケモンからアクティブにエネルギーを移動
    if (me.active) {
      for (let i = 0; i < me.bench.length; i++) {
        const b = me.bench[i];
        if (b && b.energies.length > 0) {
          const e = b.energies.pop()!;
          me.active.energies.push(e);
          addLog(s, `エネルギーつけかえ: ${b.name} → ${me.active.name} (${e})`);
          break;
        }
      }
    }
    return s;
  }

  // ── スタジアム系 ──
  if (card.subtypes.includes('Stadium')) {
    // 既存スタジアムをトラッシュ
    if (me.stadium) me.discard.push(me.stadium);
    if (opp.stadium) opp.discard.push(opp.stadium);
    me.stadium = card;
    opp.stadium = card; // 共有
    addLog(s, `スタジアム: ${card.name}`);
    return s;
  }

  // ── スペシャルレッドカード / Special Red Card ──
  // 効果: 相手の手札をデッキに戻し、1枚ドロー
  if (name === 'Special Red Card' || name.includes('スペシャルレッドカード')) {
    opp.deck.push(...opp.hand);
    opp.deck = shuffle(opp.deck);
    opp.hand = [];
    drawCards(opp, 1, s);
    addLog(s, `Special Red Card: 相手の手札リセット(1枚ドロー)`);
    return s;
  }

  // ── リーリエの決心 / Lillie's Determination (カスタムカード) ──
  // 効果: 手札が8枚になるようにドロー
  if (name.includes("Lillie's Determination") || name.includes('リーリエの決心')) {
    const need = Math.max(0, 8 - me.hand.length);
    drawCards(me, need, s);
    addLog(s, `リーリエの決心: ${need}枚ドロー（手札${me.hand.length}枚に）`);
    return s;
  }

  // ── Nの筋書き / N's Plan ──
  // 効果: ベンチポケモンからバトル場ポケモンへ最大2枚エネルギーを移動
  if (name === "N's Plan" || name.includes('Nの筋書き')) {
    if (me.active) {
      let moved = 0;
      for (let i = 0; i < me.bench.length && moved < 2; i++) {
        const b = me.bench[i];
        if (b && b.energies.length > 0) {
          const e = b.energies.pop()!;
          me.active.energies.push(e);
          addLog(s, `N's Plan: ${b.name} → ${me.active.name} (${e})`);
          moved++;
        }
      }
      if (moved === 0) addLog(s, `N's Plan: 移動するエネルギーなし`);
    }
    return s;
  }

  // ── むしとりセット / Bug Catching Set ──
  // 効果: デッキ上7枚を見て、草ポケモン・基本草エネルギーを最大2枚手札に
  if (name.includes('むしとり') || name.includes('Bug Catching')) {
    const top7 = me.deck.slice(0, 7);
    const rest  = me.deck.slice(7);
    const grassCards = top7.filter(c =>
      (c.supertype === 'Pokémon' && c.types.includes('Grass' as any)) ||
      (c.supertype === 'Energy' && (c.name.includes('Grass') || c.types.includes('Grass' as any)))
    );
    const taken = grassCards.slice(0, 2);
    for (const tc of taken) {
      const idx = top7.findIndex(c => c.id === tc.id);
      top7.splice(idx, 1);
    }
    me.hand.push(...taken);
    me.deck = [...shuffle(top7), ...rest];
    addLog(s, `むしとりセット: ${taken.length}枚取得 (${taken.map(c => c.name).join(', ')})`);
    return s;
  }

  // ── アンフェアスタンプ / Unfair Stamp (ACE SPEC, 効果近似) ──
  if (name.includes('Unfair Stamp') || name.includes('アンフェアスタンプ')) {
    // 相手の手札をリセット、3枚ドロー
    opp.deck.push(...opp.hand);
    opp.deck = shuffle(opp.deck);
    opp.hand = [];
    drawCards(opp, 3, s);
    addLog(s, `アンフェアスタンプ: 相手の手札リセット(3枚ドロー)`);
    return s;
  }

  // ── テラスタルオーブ / Terastal Orb (Pokémon Tool, 効果近似) ──
  if (name.includes('Terastal Orb') || name.includes('テラスタルオーブ')) {
    const pokemon = target === -1 ? me.active : me.bench[target ?? 0];
    if (pokemon && !pokemon.toolCard) {
      pokemon.toolCard = card;
      // 効果: テラスタルポケモンの弱点を無効化（近似: HP+30）
      pokemon.maxHp += 30;
      pokemon.currentHp = Math.min(pokemon.currentHp + 30, pokemon.maxHp);
      addLog(s, `テラスタルオーブ: ${pokemon.name} に装着`);
    }
    return s;
  }

  // ── プリズムエネルギー (Energyとして処理されるが念のため) ──
  // Energy supertype なのでattachEnergyで処理される

  // ── 未知のカード: 無視 ──
  addLog(s, `${name}: 効果未実装のためスキップ`);
  return s;
}

// ===== ワザ効果 =====

/**
 * ワザテキストに基づく追加効果を適用する。
 * useAttack から呼び出す。
 */
export function applyAttackEffect(
  state:     GameState,
  atkPi:     PlayerIndex,
  attackText: string,
  attackName: string,
  damage:    number,
): GameState {
  const s = state; // 呼び出し元でclone済み
  const atk = s.players[atkPi];
  const def = s.players[atkPi === 0 ? 1 : 0];

  // ── Phantom Dive: ベンチに6ダメカン ──
  if (attackName === 'Phantom Dive') {
    let counters = 6;
    const benchTargets = def.bench.filter((b): b is NonNullable<typeof b> => b !== null);
    if (benchTargets.length > 0) {
      // 均等にばらまく（AIは均等分配）
      const perPokemon = Math.floor(counters / benchTargets.length);
      let extra = counters % benchTargets.length;
      for (const b of benchTargets) {
        const dmg = (perPokemon + (extra-- > 0 ? 1 : 0)) * 10;
        dealDamage(b, dmg, s);
        if (b.currentHp <= 0) {
          // ベンチのきぜつ（サイド+1、ただしベンチからは補填しない）
          const prizes = b.isEx ? 2 : 1;
          atk.prizesTaken += prizes;
          const taken = def.prizes.splice(0, prizes);
          atk.hand.push(...taken);
          addLog(s, `${b.name} がベンチできぜつ！ サイド${prizes}枚`);
        }
      }
      addLog(s, `Phantom Dive: ベンチに${counters}ダメカン散布`);
    }
    return s;
  }

  // ── Tenacious Tail: 相手のexポケモン数×60 ──
  if (attackName === 'Tenacious Tail') {
    const exCount = countOppEx(def);
    // メインダメージはuseAttackで処理済み（60×）
    // parseDamageが60を返しているが実際は exCount×60 なので補正
    // ここでは追加処理なし（useAttackのdamage計算を上書きする必要がある）
    addLog(s, `Tenacious Tail: 相手のex ${exCount}体 → ${exCount * 60}ダメージ`);
    return s;
  }

  // ── Eon Blade: 次のターン攻撃不可（turnベース管理）──
  if (attackName === 'Eon Blade') {
    if (atk.active) {
      // 次の自分のターンはturn+2（相手のターンが間に入る）
      atk.active.cantAttackUntilTurn = s.turn + 2;
      addLog(s, `Eon Blade: ${atk.active.name} は次のターン攻撃できない`);
    }
    return s;
  }

  // ── Full Moon Rondo: ベンチ数×20の追加ダメージ ──
  if (attackName === 'Full Moon Rondo') {
    const myBench  = atk.bench.filter(b => b !== null).length;
    const oppBench = def.bench.filter(b => b !== null).length;
    const extra = (myBench + oppBench) * 20;
    if (def.active) {
      dealDamage(def.active, extra, s);
      addLog(s, `Full Moon Rondo: ベンチ合計${myBench + oppBench}体 → +${extra}ダメージ`);
      if (def.active.currentHp <= 0) handleKnockout(s, def, atk, def.active);
    }
    return s;
  }

  // ── Irritated Outburst (Pecharunt ex): 相手の取ったサイド数×60 ──
  if (attackName === 'Irritated Outburst') {
    // parseDamage('60×') = 60, but actual = oppPrizesTaken × 60
    // 本来のダメージは上書き不可（useAttack後に追加補正なし）
    // ここでは追加ログのみ
    addLog(s, `Irritated Outburst: 相手取得サイド${atk.prizesTaken}枚 → ${atk.prizesTaken * 60}ダメージ実際値`);
    return s;
  }

  // ── Dizzy Punch: コイン2回 ──
  if (attackName === 'Dizzy Punch') {
    const extra = [Math.random() < 0.5, Math.random() < 0.5].filter(Boolean).length * 90;
    if (def.active) {
      dealDamage(def.active, extra, s);
      addLog(s, `Dizzy Punch: コイン ${extra / 90}回表 → +${extra}ダメージ`);
      if (def.active.currentHp <= 0) handleKnockout(s, def, atk, def.active);
    }
    return s;
  }

  // ── Myriad Leaf Shower (Teal Mask Ogerpon ex): ダメカン追加 ──
  if (attackName === 'Myriad Leaf Shower') {
    // 効果: 追加ダメカンをベンチに（Phantom Diveと同様、枚数は実際のテキストに依存）
    addLog(s, `Myriad Leaf Shower: ワザ効果発動`);
    return s;
  }

  return s;
}

// ===== ダメージ修飾（ワザコスト計算前） =====

/**
 * ワザの実際ダメージを計算する（倍率系効果の上書き）。
 */
export function calcAttackDamage(
  state:    GameState,
  atkPi:    PlayerIndex,
  attack:   { name: string; damage: string; cost: string[] },
): number {
  const atk = state.players[atkPi];
  const def = state.players[atkPi === 0 ? 1 : 0];

  // Tenacious Tail: 60 × 相手のexポケモン数
  if (attack.name === 'Tenacious Tail') {
    return countOppEx(def) * 60;
  }

  // Irritated Outburst: 60 × 相手の取ったサイド数
  if (attack.name === 'Irritated Outburst') {
    return def.prizesTaken * 60;
  }

  // Dizzy Punch: コイン2回（推定値として90を返す）
  if (attack.name === 'Dizzy Punch') {
    return 90; // 期待値 = 90×0.5 + 180×0.25 = 45+45=90
  }

  // Full Moon Rondo: 20 + 20×ベンチ合計
  if (attack.name === 'Full Moon Rondo') {
    const myBench  = atk.bench.filter(b => b !== null).length;
    const oppBench = def.bench.filter(b => b !== null).length;
    return 20 + (myBench + oppBench) * 20;
  }

  // デフォルト: damage文字列をパース
  if (!attack.damage) return 0;
  const n = parseInt(attack.damage.replace(/[^0-9]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ===== ユーティリティ =====

export function makeBenchPokemon(card: CardData, turn: number): import('./types.js').ActivePokemon {
  const isEx = card.subtypes.some(s => ['ex','EX','V','VMAX','VSTAR'].includes(s));
  return {
    cardId:   card.id,
    name:     card.name,
    maxHp:    card.hp ?? 0,
    currentHp: card.hp ?? 0,
    status:   'none',
    energies: [],
    damageCounters: 0,
    isEx,
    evolveBlocked: true, // 出したターンは進化不可
    toolCard:  null,
    cantAttackUntilTurn: -1,
  };
}

function countOppEx(def: import('./types.js').PlayerState): number {
  let n = (def.active?.isEx ? 1 : 0);
  for (const b of def.bench) if (b?.isEx) n++;
  return n;
}

function oppBestTargetSlot(bench: (import('./types.js').ActivePokemon | null)[]): number {
  let best = -1, bestHp = -1;
  for (let i = 0; i < bench.length; i++) {
    const b = bench[i];
    if (b && b.currentHp > bestHp) { bestHp = b.currentHp; best = i; }
  }
  return best;
}
