#!/usr/bin/env python3
"""Total cost per user per month: 3 videos + 5 follow-up questions each.

MEASURED  = observed in this account today (bench runs / CloudWatch REPORT).
MODELLED  = derived from code inspection (prompt sizes, poll counts) — labelled.
"""

# ── LLM pricing, USD per 1M tokens (openai pricing page, 2026-08-01) ────────
PRICE = {'gpt-5.2': (1.75, 14.00), 'gpt-5.6-terra': (2.00, 12.00),
         'gpt-5.6-luna': (0.20, 1.20), 'gpt-4o-mini': (0.15, 0.60)}

VIDEOS, QS_PER_VIDEO = 3, 5
CHATS = VIDEOS * QS_PER_VIDEO  # 15

# ── Analysis: MEASURED token usage from the 5-swing bench ──────────────────
AN_IN, AN_OUT = 20684, 1377          # gpt-5.2 measured
AN_IN_T, AN_OUT_T = 20681, 1041      # terra measured
AN_SECS = {'gpt-5.2': 26.0, 'gpt-5.6-terra': 13.7, 'gpt-5.6-luna': 9.9}  # MEASURED

# ── Chat: MODELLED context (component sizes measured from the prompt code) ─
# system 236 + developer ctx ~700 (w/ summaries+visual obs) + loaded video
# ctx ~500 + mode instruction ~100 + tool defs 600 + up to 12 recent turns
# (~2000) = ~4,100 in; max_completion_tokens is 450, assume ~300 used.
CHAT_IN, CHAT_OUT = 4100, 300
# The visual tool re-pulls frames (~2k tokens/frame, measured from analysis:
# 20.6k for 10 frames). Assume 30% of questions trigger it, 3 frames, and a
# second model round-trip carrying the same context.
VIS_SHARE, VIS_EXTRA_IN, VIS_EXTRA_OUT = 0.30, 4100 + 6000, 300

# ── AWS unit prices (us-east-1, on-demand) ─────────────────────────────────
LAMBDA_GBS = 0.0000166667
LAMBDA_REQ = 0.20 / 1_000_000
APIGW_REQ = 3.50 / 1_000_000
S3_STORE_GB_MO, S3_PUT, S3_GET = 0.023, 0.005 / 1000, 0.0004 / 1000
DDB_WRU, DDB_RRU = 1.25 / 1_000_000, 0.25 / 1_000_000

# ── Per-video pipeline (MEASURED durations unless noted) ───────────────────
EXTRACT_MB, EXTRACT_S = 2048, 2.8    # MEASURED avg billed (short clips)
UPLOAD_MB, UPLOAD_S = 256, 0.45      # MEASURED
RESULTS_MB, RESULTS_S = 128, 1.1     # MEASURED per poll
CHAT_MB, CHAT_S = 256, 5.0           # MODELLED: dominated by the OpenAI call
POLLS = 25                           # MODELLED: 1.5s interval over ~40s
VIDEO_MB, FRAMES_MB = 18, 1.5        # MODELLED: 1080p ~10s clip + 10 frames


def lam(mb, secs, n=1):
    return n * (mb / 1024 * secs * LAMBDA_GBS + LAMBDA_REQ)


def llm(model, tin, tout):
    i, o = PRICE[model]
    return (tin * i + tout * o) / 1_000_000


def analysis_cost(model):
    tin, tout = (AN_IN_T, AN_OUT_T) if model != 'gpt-5.2' else (AN_IN, AN_OUT)
    return llm(model, tin, tout)


def chat_cost(model):
    base = llm(model, CHAT_IN, CHAT_OUT)
    vis = llm(model, VIS_EXTRA_IN, VIS_EXTRA_OUT) * VIS_SHARE
    return base + vis


def infra_per_video(an_secs):
    lambda_cost = (lam(EXTRACT_MB, EXTRACT_S) + lam(UPLOAD_MB, UPLOAD_S)
                   + lam(1024, an_secs) + lam(RESULTS_MB, RESULTS_S, POLLS))
    api = APIGW_REQ * (2 + POLLS)
    s3 = S3_PUT * 11 + S3_GET * 20 + (VIDEO_MB + FRAMES_MB) / 1024 * S3_STORE_GB_MO
    ddb = DDB_WRU * 15 + DDB_RRU * (POLLS + 10)
    return lambda_cost + api + s3 + ddb


def infra_per_chat():
    return lam(CHAT_MB, CHAT_S) + APIGW_REQ + DDB_WRU * 4 + DDB_RRU * 6


def scenario(name, an_model, chat_model):
    an_llm = analysis_cost(an_model) * VIDEOS
    ch_llm = chat_cost(chat_model) * CHATS
    infra = infra_per_video(AN_SECS[an_model]) * VIDEOS + infra_per_chat() * CHATS
    total = an_llm + ch_llm + infra
    print(f"\n{name}")
    print(f"  analysis LLM ({an_model:14s}) x{VIDEOS:2d}  ${an_llm:7.4f}")
    print(f"  chat LLM     ({chat_model:14s}) x{CHATS:2d}  ${ch_llm:7.4f}")
    print(f"  AWS infra (lambda/s3/ddb/apigw)     ${infra:7.4f}")
    print(f"  {'TOTAL / user / month':36s}${total:7.4f}")
    print(f"  {'annualized':36s}${total*12:7.2f}")
    return total


print("=" * 62)
print("COST PER USER / MONTH — 3 videos + 5 follow-ups each (15 chats)")
print("=" * 62)
cur = scenario("A. TODAY (gpt-5.2 everywhere — deployed reality)", 'gpt-5.2', 'gpt-5.2')
rec = scenario("B. RECOMMENDED (terra analysis, gpt-5.2 chat)", 'gpt-5.6-terra', 'gpt-5.2')
mix = scenario("C. + cheap chat (terra analysis, 4o-mini chat)", 'gpt-5.6-terra', 'gpt-4o-mini')
lean = scenario("D. LEAN (luna analysis, 4o-mini chat)", 'gpt-5.6-luna', 'gpt-4o-mini')

print("\n" + "=" * 62)
print(f"{'scenario':10s} {'$/user/mo':>10s} {'vs today':>10s} {'@ $10 sub':>12s}")
for n, v in (('A today', cur), ('B rec', rec), ('C mixed', mix), ('D lean', lean)):
    print(f"{n:10s} {v:10.4f} {(1-v/cur)*100:9.1f}% {(1-v/10)*100:11.1f}% margin")

print("\nComposition of today's cost:")
print(f"  chat is {chat_cost('gpt-5.2')*CHATS/cur*100:.0f}% of total "
      f"(15 turns x ${chat_cost('gpt-5.2'):.4f})")
print(f"  analysis is {analysis_cost('gpt-5.2')*VIDEOS/cur*100:.0f}% "
      f"(3 x ${analysis_cost('gpt-5.2'):.4f})")
print(f"  AWS infra is {(infra_per_video(26.0)*VIDEOS+infra_per_chat()*CHATS)/cur*100:.0f}% "
      f"(${infra_per_video(26.0)*VIDEOS+infra_per_chat()*CHATS:.4f})")
