import { queryJev, queryJevWithQuestion } from "./jev-client";
import type { JevDecision, JevChoiceQuestion } from "../types";

export interface EnsembleDecision {
  readonly finalDecision: "BUY" | "SELL" | "HOLD";
  readonly finalProbability: number;
  readonly finalConfidence: number;
  readonly votes: readonly JevDecision[];
  readonly agreement: number;
  readonly method: "majority" | "weighted" | "consensus";
}

export interface EnsembleConfig {
  readonly queryCount: number;
  readonly method: "majority" | "weighted" | "consensus";
  readonly confidenceThreshold: number;
}

const INSTRUCTION_ANGLES: readonly string[] = [
  "Given the current market state, order book, and technical indicators, what is the optimal trading action? Focus on MOMENTUM and TREND following. Look for strong directional moves, MACD crossovers, RSI extremes, and volume confirmation.",
  "Given the current market state, order book, and technical indicators, what is the optimal trading action? Focus on RISK MANAGEMENT and capital preservation. Consider drawdown limits, position sizing, stop-loss levels, and risk/reward ratios. Only take high-conviction trades.",
  "Given the current market state, order book, and technical indicators, what is the optimal trading action? Focus on MEAN REVERSION and support/resistance. Look for price extremes, Bollinger Band touches, RSI divergence, and oversold/overbought conditions.",
  "Given the current market state, order book, and technical indicators, what is the optimal trading action? Focus on BREAKOUT and VOLATILITY. Look for consolidation patterns, Bollinger squeeze, volume spikes, and ATR expansion.",
];

const DEFAULT_CRITERIA: Record<string, string | null> = {
  BUY: "Strong bullish signal — price likely to rise. High-confidence entry opportunity.",
  SELL: "Strong bearish signal — price likely to fall. High-confidence exit or short opportunity.",
  HOLD: "Ambiguous, choppy, or low-conviction market. No clear edge — stay flat.",
};

function buildQuestion(instructions: string): JevChoiceQuestion {
  return { type: "choice", instructions, criteria: DEFAULT_CRITERIA };
}

async function queryJevWithAngle(stateString: string, angleIndex: number): Promise<JevDecision> {
  const instructions = INSTRUCTION_ANGLES[angleIndex % INSTRUCTION_ANGLES.length]!;
  const question = buildQuestion(instructions);
  return queryJevWithQuestion(stateString, question);
}

function aggregateMajority(
  votes: readonly JevDecision[],
  confidenceThreshold: number,
): { decision: "BUY" | "SELL" | "HOLD"; probability: number; confidence: number; agreement: number } {
  const validVotes = votes.filter(v => v.confidence >= confidenceThreshold);
  const counts: Record<string, number> = { BUY: 0, SELL: 0, HOLD: 0 };
  let totalConf = 0;
  let totalProb = 0;

  for (const v of validVotes) {
    counts[v.choice] = (counts[v.choice] ?? 0) + 1;
    totalConf += v.confidence;
    totalProb += v.probability;
  }

  const total = validVotes.length || 1;
  let bestChoice: "BUY" | "SELL" | "HOLD" = "HOLD";
  let bestCount = 0;

  for (const choice of ["BUY", "SELL", "HOLD"] as const) {
    const c = counts[choice]!;
    if (c > bestCount) {
      bestCount = c;
      bestChoice = choice;
    }
  }

  return {
    decision: bestChoice,
    probability: totalProb / total,
    confidence: totalConf / total,
    agreement: bestCount / (votes.length || 1),
  };
}

function aggregateWeighted(
  votes: readonly JevDecision[],
  confidenceThreshold: number,
): { decision: "BUY" | "SELL" | "HOLD"; probability: number; confidence: number; agreement: number } {
  const scores: Record<string, number> = { BUY: 0, SELL: 0, HOLD: 0 };
  let totalConf = 0;
  let totalProb = 0;
  let validCount = 0;

  for (const v of votes) {
    if (v.confidence >= confidenceThreshold) {
      scores[v.choice] = (scores[v.choice] ?? 0) + v.probability * v.confidence;
      totalConf += v.confidence;
      totalProb += v.probability;
      validCount++;
    }
  }

  const total = validCount || 1;
  let bestChoice: "BUY" | "SELL" | "HOLD" = "HOLD";
  let bestScore = 0;

  for (const choice of ["BUY", "SELL", "HOLD"] as const) {
    const s = scores[choice]!;
    if (s > bestScore) {
      bestScore = s;
      bestChoice = choice;
    }
  }

  const buyScore = scores["BUY"]!;
  const sellScore = scores["SELL"]!;
  const holdScore = scores["HOLD"]!;
  const maxScore = Math.max(buyScore, sellScore, holdScore) || 1;

  return {
    decision: bestChoice,
    probability: totalProb / total,
    confidence: totalConf / total,
    agreement: maxScore / (buyScore + sellScore + holdScore || 1),
  };
}

function aggregateConsensus(
  votes: readonly JevDecision[],
  confidenceThreshold: number,
): { decision: "BUY" | "SELL" | "HOLD"; probability: number; confidence: number; agreement: number } {
  const validVotes = votes.filter(v => v.confidence >= confidenceThreshold);

  if (validVotes.length === 0) {
    return { decision: "HOLD", probability: 0, confidence: 0, agreement: 0 };
  }

  const firstChoice = validVotes[0]!.choice;
  const allSame = validVotes.every(v => v.choice === firstChoice);

  if (allSame && firstChoice !== "HOLD") {
    const avgProb = validVotes.reduce((s, v) => s + v.probability, 0) / validVotes.length;
    const avgConf = validVotes.reduce((s, v) => s + v.confidence, 0) / validVotes.length;
    return { decision: firstChoice, probability: avgProb, confidence: avgConf, agreement: 1 };
  }

  return { decision: "HOLD", probability: 0, confidence: 0, agreement: validVotes.length / (votes.length || 1) };
}

export async function queryEnsemble(
  stateString: string,
  config: EnsembleConfig,
): Promise<EnsembleDecision> {
  if (config.queryCount <= 1) {
    const single = await queryJev(stateString);
    return {
      finalDecision: single.choice,
      finalProbability: single.probability,
      finalConfidence: single.confidence,
      votes: [single],
      agreement: 1,
      method: config.method,
    };
  }

  const votes: JevDecision[] = [];
  for (let i = 0; i < config.queryCount; i++) {
    const vote = await queryJevWithAngle(stateString, i);
    votes.push(vote);
  }

  let result: { decision: "BUY" | "SELL" | "HOLD"; probability: number; confidence: number; agreement: number };

  switch (config.method) {
    case "weighted":
      result = aggregateWeighted(votes, config.confidenceThreshold);
      break;
    case "consensus":
      result = aggregateConsensus(votes, config.confidenceThreshold);
      break;
    case "majority":
    default:
      result = aggregateMajority(votes, config.confidenceThreshold);
      break;
  }

  return {
    finalDecision: result.decision,
    finalProbability: result.probability,
    finalConfidence: result.confidence,
    votes,
    agreement: result.agreement,
    method: config.method,
  };
}
