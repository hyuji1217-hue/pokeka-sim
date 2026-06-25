// ===== カードデータ型 =====

export type Supertype = 'Pokémon' | 'Trainer' | 'Energy';
export type EnergyType = 'Fire' | 'Water' | 'Grass' | 'Lightning' | 'Psychic' | 'Fighting' | 'Darkness' | 'Metal' | 'Dragon' | 'Colorless' | 'Fairy';

export interface Attack {
  name:   string;
  cost:   EnergyType[];
  damage: string;   // "60" | "60+" | "60×" | ""
  text:   string;
}

export interface Ability {
  name: string;
  type: string;   // "Ability" | "Poké-Power" | "Poké-Body"
  text: string;
}

export interface CardData {
  id:          string;
  name:        string;
  supertype:   Supertype;
  subtypes:    string[];
  hp:          number | null;
  types:       EnergyType[];
  attacks:     Attack[];
  abilities:   Ability[];
  weaknesses:  { type: EnergyType; value: string }[];
  resistances: { type: EnergyType; value: string }[];
  retreatCost: EnergyType[];
  evolvesFrom: string | null;
  evolvesTo:   string[];
  rules:       string[];
  rarity:      string;
  set:         { id: string; name: string; series: string };
}

// ===== ゲーム内の状態型 =====

export type StatusCondition = 'none' | 'poisoned' | 'burned' | 'paralyzed' | 'confused' | 'asleep';
export type PlayerIndex = 0 | 1;

export interface ActivePokemon {
  cardId:            string;       // cards.json のキー
  name:              string;
  maxHp:             number;
  currentHp:         number;
  status:            StatusCondition;
  energies:          EnergyType[]; // 付いているエネルギーカード
  damageCounters:    number;
  isEx:              boolean;
  evolveBlocked:     boolean;      // 出したターンは進化不可
  toolCard:          CardData | null; // ポケモンの道具
  cantAttackUntilTurn: number;     // Eon Blade等: このターン以下なら攻撃不可、-1=制限なし
}

export interface PlayerState {
  deck:                   CardData[];
  hand:                   CardData[];
  bench:                  (ActivePokemon | null)[];
  active:                 ActivePokemon | null;
  discard:                CardData[];
  prizes:                 CardData[];
  prizesTaken:            number;
  supporterPlayedThisTurn: boolean;
  energyAttachedThisTurn: boolean;
  stadium:                CardData | null;   // 場に出ているスタジアム
}

export type GamePhase = 'setup' | 'draw' | 'main' | 'attack' | 'between-turns' | 'end';
export type Winner = PlayerIndex | 'draw' | null;

export interface GameState {
  turn:         number;
  activePlayer: PlayerIndex;
  phase:        GamePhase;
  players:      [PlayerState, PlayerState];
  winner:       Winner;
  firstTurn:    boolean;      // 先行1ターン目はワザを使えない
  log:          string[];
}

// ===== AI・シミュレーター型 =====

export type ActionType =
  | 'draw'
  | 'play-pokemon'
  | 'attach-energy'
  | 'play-trainer'
  | 'evolve'
  | 'attack'
  | 'retreat'
  | 'end-turn';

export interface Action {
  type:             ActionType;
  cardIndex?:       number;   // hand内のインデックス
  targetSlot?:      number;   // bench内のスロット番号（-1=active）
  attackIndex?:     number;
  trainerTarget?:   number;   // ボスの指令等: 相手のベンチスロット
  discardIndices?:  number[]; // ハイパーボール: 捨てるカードのインデックス
}

export interface SimResult {
  winner:   PlayerIndex | 'draw';
  turns:    number;
  log?:     string[];
}
