// gameConfig.js — Lazy cached slice of api2 `gameConfig.getGameConfig`.
// The full payload is ~180KB of mostly player-facing mechanics; we only expose
// the news-relevant sections (newspaper pricing, election cycle, law rules).
// Cached in S.state with a TTL; lazy + prefetchable like itemHistory.js.

import { S } from "../core/state.js";
import { apiKey, fetchTrpcApi2, unwrap } from "../core/api.js";

const TTL_MS = 12 * 60 * 60 * 1000;

const DEFAULTS = {
  newspaper: { tipValue: 5, gemTipValue: 5, publishCost: 3, createArticleMinLevel: 5 },
  election: { candidateDurationHours: 24, electionVoteDurationHours: 24, voteMinLevel: 15, candidateMinLevel: 15 },
};

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalize(raw) {
  const n = raw?.newspaper || {};
  const e = raw?.election || {};
  return {
    newspaper: {
      tipValue: num(n.tipValue, DEFAULTS.newspaper.tipValue),
      gemTipValue: num(n.gemTipValue, DEFAULTS.newspaper.gemTipValue),
      publishCost: num(n.publishCost, DEFAULTS.newspaper.publishCost),
      createArticleMinLevel: num(n.createArticleMinLevel, DEFAULTS.newspaper.createArticleMinLevel),
    },
    election: {
      candidateDurationHours: num(e.candidateDurationHours, DEFAULTS.election.candidateDurationHours),
      electionVoteDurationHours: num(e.electionVoteDurationHours, DEFAULTS.election.electionVoteDurationHours),
      voteMinLevel: num(e.voteMinLevel, DEFAULTS.election.voteMinLevel),
      candidateMinLevel: num(e.candidateMinLevel, DEFAULTS.election.candidateMinLevel),
    },
    law: raw?.law || null,
    region: raw?.region || null,
    unrest: raw?.unrest || null,
    battle: {
      roundsToWin: num(raw?.battle?.roundsToWin, 2),
      maxRounds: num(raw?.battle?.maxRounds, 15),
      pointsToWinRound: num(raw?.battle?.pointsToWinRound, 300),
      healthCost: num(raw?.battle?.healthCost, 10),
    },
  };
}

async function load(force = false) {
  const cached = S.gameConfig;
  if (cached && !force && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  const k = apiKey();
  if (!k) return cached || null;
  try {
    const r = await fetchTrpcApi2("gameConfig.getGameConfig", {}, k);
    const raw = unwrap(r);
    if (!raw) return cached || null;
    const cfg = { ...normalize(raw), fetchedAt: Date.now() };
    S.gameConfig = cfg;
    return cfg;
  } catch {
    return cached || null;
  }
}

export async function fetchGameConfig(force = false) {
  return load(force);
}

export function getGameConfig() {
  const c = S.gameConfig;
  if (!c || Date.now() - c.fetchedAt > TTL_MS) return null;
  return c;
}

export function getNewspaperConfig() {
  return getGameConfig()?.newspaper || null;
}

// Returns the effective tip values, falling back to sane defaults so callers
// never need to re-derive constants themselves.
export function tipValues() {
  const n = getNewspaperConfig();
  return {
    btc: n?.tipValue ?? DEFAULTS.newspaper.tipValue,
    gem: n?.gemTipValue ?? DEFAULTS.newspaper.gemTipValue,
    publishCost: n?.publishCost ?? DEFAULTS.newspaper.publishCost,
  };
}

export const GAME_CONFIG_DEFAULTS = DEFAULTS;