# OptionViz

A personal options-trade visualizer. Upload a screenshot of your broker's order ticket → Claude vision parses it → see payoff diagrams (today / mid / expiry), full Greeks, max profit/loss, breakevens, probability of profit, and Claude-generated alternative-strategy ideas.

Built for: covered calls, cash-secured puts, long calls, and arbitrary multi-leg structures.

## Stack
- **Next.js 15** (App Router) + TypeScript + Tailwind — deployed on Vercel
- **Supabase** — Postgres for trade storage
- **Anthropic SDK** — vision (ticket parsing) + reasoning (alt-strategy ideas)
- **Recharts** — payoff charts
- Black-Scholes pricing & Greeks implemented in `lib/black-scholes.ts`

## Setup

### 0. Prerequisites
- Node.js 20+ (`brew install node` on macOS, or use nvm)
- A Supabase project
- An Anthropic API key

### 1. Install
```bash
npm install
```

### 2. Supabase
1. Create a Supabase project.
2. In the SQL editor, run `supabase/migrations/0001_init.sql`.
3. Copy the URL, anon key, and service-role key into `.env.local`.

### 3. Env vars
Copy `.env.example` to `.env.local` and fill in:
- `ANTHROPIC_API_KEY` — Claude API (vision + ideas)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### 4. Run
```bash
npm run dev
```
Open http://localhost:3000.

## Deploy (Vercel)
1. `vercel link` then `vercel`.
2. Add the same env vars in the Vercel dashboard.
3. Push to `main` → auto-deploy.

## How it works

| Path | Purpose |
| --- | --- |
| `/` | List of saved trades |
| `/trade/new` | Upload ticket screenshot or fill form manually |
| `/trade/[id]` | Payoff chart, Greeks, stats, alternative ideas |
| `app/api/parse-ticket` | Claude vision → structured trade JSON |
| `app/api/ideas` | Claude reasoning → alt strategies |
| `app/api/trades` | CRUD against Supabase |

## Math notes
- European Black-Scholes (good enough for short-dated US equity options; American early-exercise on calls is rare without dividends).
- Greeks are reported per-position with the standard $100 contract multiplier on dollar values (theta/vega/rho per 1 day / 1 vol point / 1 rate point).
- Implied vol is solved via bisection from the entered premium.
- Probability of profit is a Monte Carlo (4k samples) over a lognormal terminal price using the average leg IV.
- Margin is a rough heuristic — verify with your broker.

## Roadmap
- Live underlying quote pull (Polygon/Tradier) so the chart can re-anchor as the market moves
- Per-leg IV editing in the UI (already supported in the data model)
- Alert when a saved position has crossed a breakeven
- Export to broker-ready order ticket
