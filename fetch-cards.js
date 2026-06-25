#!/usr/bin/env node
/**
 * fetch-cards.js
 * pokemontcg.io から Standard合法カード（SV系セット）を取得し
 * data/cards.json に保存する。node:https を使用（fetch より安定）。
 * 実行: node fetch-cards.js
 */

import https from 'node:https';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_KEY   = '9409ea69-00fa-4ffc-bf12-10b18fce226e';
const BASE      = 'api.pokemontcg.io';
const PAGE_SIZE = 250;

function get(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { hostname: BASE, path, headers: { 'X-Api-Key': API_KEY } },
      res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch(e) { reject(new Error(`JSON parse error (${res.statusCode}): ${body.slice(0,100)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatCard(raw) {
  return {
    id:          raw.id,
    name:        raw.name,
    supertype:   raw.supertype,
    subtypes:    raw.subtypes   ?? [],
    hp:          raw.hp ? parseInt(raw.hp) : null,
    types:       raw.types      ?? [],
    attacks:     (raw.attacks   ?? []).map(a => ({
      name: a.name, cost: a.cost ?? [], damage: a.damage ?? '', text: a.text ?? '',
    })),
    abilities:   (raw.abilities ?? []).map(a => ({
      name: a.name, type: a.type, text: a.text,
    })),
    weaknesses:  (raw.weaknesses  ?? []).map(w => ({ type: w.type, value: w.value })),
    resistances: (raw.resistances ?? []).map(r => ({ type: r.type, value: r.value })),
    retreatCost: raw.retreatCost ?? [],
    evolvesFrom: raw.evolvesFrom ?? null,
    evolvesTo:   raw.evolvesTo   ?? [],
    rules:       raw.rules       ?? [],
    rarity:      raw.rarity      ?? '',
    set: {
      id: raw.set?.id ?? '', name: raw.set?.name ?? '', series: raw.set?.series ?? '',
    },
  };
}

async function fetchCardsForSet(setId) {
  const cards = [];
  let page = 1;
  while (true) {
    const path = `/v2/cards?pageSize=${PAGE_SIZE}&page=${page}&q=set.id:${setId}&select=id,name,supertype,subtypes,hp,types,attacks,abilities,weaknesses,resistances,retreatCost,evolvesFrom,evolvesTo,rules,set,rarity`;
    const data = await get(path);
    cards.push(...(data.data ?? []).map(formatCard));
    if (cards.length >= (data.totalCount ?? 0)) break;
    page++;
    await sleep(150);
  }
  return cards;
}

async function main() {
  console.log('[fetch-cards] セット一覧を取得中...');
  const setsData = await get('/v2/sets?pageSize=250&orderBy=-releaseDate');
  const allSets  = setsData.data ?? [];

  // SV系（Scarlet & Violet シリーズ）のみ
  const svSets = allSets.filter(s => s.series === 'Scarlet & Violet');
  console.log(`[fetch-cards] SVセット: ${svSets.length}個`);
  svSets.forEach(s => console.log(`  ${s.id}: ${s.name} (${s.total}枚)`));

  // 中断再開用のチェックポイント
  const checkpointPath = join(__dirname, 'data', '_checkpoint.json');
  let checkpoint = {};
  if (existsSync(checkpointPath)) {
    checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf-8'));
    console.log(`[fetch-cards] チェックポイント検出: ${Object.keys(checkpoint).length}セット取得済み`);
  }

  mkdirSync(join(__dirname, 'data'), { recursive: true });

  let allCards = [];

  // 取得済みセットを読み込み
  for (const [setId, cards] of Object.entries(checkpoint)) {
    allCards.push(...cards);
  }

  // 未取得セットを取得
  for (let i = 0; i < svSets.length; i++) {
    const set = svSets[i];
    if (checkpoint[set.id]) {
      process.stdout.write(`\r[fetch-cards] [${i+1}/${svSets.length}] ${set.id}: スキップ済み`);
      continue;
    }
    process.stdout.write(`\r[fetch-cards] [${i+1}/${svSets.length}] ${set.id}: 取得中...   `);
    const cards = await fetchCardsForSet(set.id);
    checkpoint[set.id] = cards;
    allCards.push(...cards);
    writeFileSync(checkpointPath, JSON.stringify(checkpoint));
    await sleep(200);
  }

  console.log(`\n[fetch-cards] 合計 ${allCards.length}枚取得`);

  // id キーのマップ形式で保存
  const cardMap = {};
  for (const c of allCards) cardMap[c.id] = c;

  const outPath = join(__dirname, 'data', 'cards.json');
  writeFileSync(outPath, JSON.stringify(cardMap, null, 2));
  const sizeKB = Math.round(JSON.stringify(cardMap).length / 1024);
  console.log(`[fetch-cards] 保存完了: data/cards.json (${sizeKB} KB)`);

  const pokemon = allCards.filter(c => c.supertype === 'Pokémon').length;
  const trainer = allCards.filter(c => c.supertype === 'Trainer').length;
  const energy  = allCards.filter(c => c.supertype === 'Energy').length;
  console.log(`ポケモン:${pokemon} / トレーナーズ:${trainer} / エネルギー:${energy}`);
}

main().catch(e => {
  console.error('\n[fetch-cards] エラー:', e.message);
  process.exit(1);
});
