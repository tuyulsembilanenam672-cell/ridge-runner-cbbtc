// Ridge Runner: a two-leg, flat-by-default trend bot for cbBTC on 1-minute bars.
//
// Why two legs: one 24h window is not like another. A rising window pays a
// bot that buys an early up-move and rides it; a falling, bouncy window pays
// a bot that buys a sharp dip only once the fall has paused and exits fast.
// This bot runs both ideas through a single position slot, trend first:
//
//   Trend leg (the money leg on a rising window). When flat, buy full size
//   the moment the close is up at least 5 bps over the last 30 bars. Hold
//   with a wide trailing stop: sell only when the position's value has
//   fallen 250 bps from its peak, so ordinary chop never shakes it out.
//   After a trend exit, wait 120 bars before any new trend entry, so a
//   grinding fall cannot churn it through repeated buy-the-bounce losses.
//
//   Dip leg (the insurance leg on a falling or choppy window). When flat and
//   the trend leg does not fire, buy full size only on a confirmed pause
//   after a sharp drop: the close down at least 60 bps over 10 bars, with
//   the last 2 bars flat or up. Exit fast -- take profit at +120 bps over
//   cost, stop at -80 bps, trailing stop 50 bps off the peak, or a 15-bar
//   time exit -- then wait 10 bars before the next dip entry.
//
//   A sell the market refuses leaves its leg in charge, so the exit is
//   sent again on the next bar instead of being forgotten; the cooldown
//   only starts once the position is actually gone.
//
//   No new entries in the last 30 bars: an entry that late only pays the
//   final flatten. Long only, no leverage, one position at a time, fully
//   deterministic: signals are measured on closes only, in basis points,
//   with plain float64 arithmetic in a fixed order, so the same bars give
//   the same orders on every run. Orders fill at the next bar's open, so
//   every decision is made on the close just seen, and exits are judged on
//   the position's cost and value as the harness reports them (cost already
//   includes the buy fee, value already reflects slippage and impact).

import { runBars, type BarsState, type Batch } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";

/** Trend entry: the close up this far over the last TREND_WIN bars. */
const TREND_WIN = 30;
const TREND_MIN_BPS = 5;
/** Trend exit: the position's value this far below its peak while held. */
const TREND_TRAIL_BPS = 250;
/** Bars to wait after a trend exit before another trend entry. */
const TREND_COOLDOWN = 120;
/** Dip entry: the close down this far over DIP_DROP_WIN bars, with the
 *  last DIP_TURN_WIN bars flat or up (the fall has paused). */
const DIP_DROP_WIN = 10;
const DIP_DROP_BPS = 60;
const DIP_TURN_WIN = 2;
const DIP_TURN_BPS = 0;
/** Dip exits: take profit / stop loss / trailing stop, in bps of cost or peak. */
const DIP_TAKE_BPS = 120;
const DIP_STOP_BPS = 80;
const DIP_TRAIL_BPS = 50;
/** Dip exit: give up after this many bars held, whatever the price. */
const DIP_MAX_HOLD = 15;
/** Bars to wait after a dip exit before another dip entry. */
const DIP_COOLDOWN = 10;
/** No new entries on or after this batch (the window has 1440 bars). */
const NO_ENTRY_AFTER = 1410;
/** Slippage cap on every order, measured from the latest close. One-minute
 *  moves on this market stay well under it, so fills are rarely refused. */
const MAX_SLIP = 150;

/** Closes seen so far, oldest first, as plain numbers (raw price units). */
const closes: number[] = [];
/** Which leg holds the current position, or null while flat. */
let leg: "trend" | "dip" | null = null;
/** The leg whose exit was just decided: its cooldown applies once the
 *  position is actually gone (a sell the market refuses leaves the leg
 *  in charge, so the exit is sent again instead of being forgotten). */
let exitedLeg: "trend" | "dip" | null = null;
/** Bars since the last trend exit / dip exit; 0 means free to enter. */
let trendCooldown = 0;
let dipCooldown = 0;
/** Bars held of the current position, and its peak value while held. */
let heldBars = 0;
let peakValue = 0n;

/** Return of the close now versus the close `win` bars back, in bps. */
function retBps(win: number): number | null {
  const n = closes.length;
  if (n <= win) return null;
  const then = closes[n - 1 - win];
  const now = closes[n - 1];
  if (then <= 0) return null;
  return ((now - then) * 10000) / then;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) closes.push(Number(bar.c));
    }
    if (closes.length === 0) return [];
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      heldBars += 1;
      const value = state.value(SYMBOL, held.qty);
      if (value > peakValue) peakValue = value;
      if (leg === "trend") {
        const trailed =
          peakValue > 0n &&
          value * 10000n <= peakValue * BigInt(10000 - TREND_TRAIL_BPS);
        if (trailed) {
          exitedLeg = "trend";
          return [{ side: "sell", symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIP }];
        }
        return [];
      }
      // Dip leg: take profit, stop loss, trailing stop, time exit.
      const cost = held.cost;
      const take = value * 10000n >= cost * BigInt(10000 + DIP_TAKE_BPS);
      const stop = value * 10000n <= cost * BigInt(10000 - DIP_STOP_BPS);
      const trail =
        peakValue > 0n &&
        value * 10000n <= peakValue * BigInt(10000 - DIP_TRAIL_BPS);
      const stale = heldBars >= DIP_MAX_HOLD;
      if (take || stop || trail || stale) {
        exitedLeg = "dip";
        return [{ side: "sell", symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIP }];
      }
      return [];
    }

    // Flat: the position is gone, so a decided exit takes effect now.
    if (exitedLeg === "trend") trendCooldown = TREND_COOLDOWN;
    if (exitedLeg === "dip") dipCooldown = DIP_COOLDOWN;
    exitedLeg = null;
    leg = null;
    heldBars = 0;
    peakValue = 0n;
    if (trendCooldown > 0) trendCooldown -= 1;
    if (dipCooldown > 0) dipCooldown -= 1;
    if (state.seq >= NO_ENTRY_AFTER) return [];

    // Trend entry first: a confirmed 30-bar up-move.
    const trend = retBps(TREND_WIN);
    if (trend !== null && trend >= TREND_MIN_BPS && trendCooldown === 0) {
      let notional = state.cash;
      const room = state.weightRoom(SYMBOL);
      if (notional > room) notional = room;
      if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
      leg = "trend";
      return [{ side: "buy", symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIP }];
    }

    // Dip entry: a sharp drop whose fall has just paused.
    if (dipCooldown > 0) return [];
    const drop = retBps(DIP_DROP_WIN);
    const turn = retBps(DIP_TURN_WIN);
    if (
      drop !== null &&
      turn !== null &&
      drop <= -DIP_DROP_BPS &&
      turn >= DIP_TURN_BPS
    ) {
      let notional = state.cash;
      const room = state.weightRoom(SYMBOL);
      if (notional > room) notional = room;
      if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
      leg = "dip";
      return [{ side: "buy", symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIP }];
    }
    return [];
  },
});
