#!/usr/bin/env python3
"""
report.py — Generate an HTML report from benchmark-results.json.

Renders A/B test results as a side-by-side conversation layout
with a dark minimalist theme inspired by mem9.ai.

Usage:
    python3 benchmark/scripts/report.py benchmark/results/<run>/benchmark-results.json > report.html
"""

import html
import json
import re
import sys


def classify_turn(prompt):
    """Classify a prompt as store, query, or story based on content."""
    lower = prompt.lower().strip()
    if lower.startswith("[store]") or lower.startswith("store:"):
        return "store"
    if lower.startswith("[query]") or lower.startswith("query:") or lower.startswith("recall"):
        return "query"
    if lower.startswith("[story]") or lower.startswith("story:") or "write a short story" in lower or "tell me a story" in lower or "creative writing" in lower:
        return "story"
    # Heuristic fallbacks
    if any(kw in lower for kw in ["remember", "store", "save", "note that", "record"]):
        return "store"
    if any(kw in lower for kw in ["what do you", "recall", "do you remember", "what was", "tell me about"]):
        return "query"
    return "story"


def render_markdown(text):
    """Lightweight markdown to HTML conversion using stdlib only."""
    if not text:
        return "<em>(no response)</em>"

    escaped = html.escape(text)
    lines = escaped.split("\n")
    result_lines = []

    for line in lines:
        # Headers
        if line.startswith("### "):
            result_lines.append(f"<h4>{line[4:]}</h4>")
            continue
        if line.startswith("## "):
            result_lines.append(f"<h3>{line[3:]}</h3>")
            continue
        if line.startswith("# "):
            result_lines.append(f"<h2>{line[2:]}</h2>")
            continue

        # Horizontal rule
        if re.match(r"^-{3,}$", line.strip()):
            result_lines.append("<hr>")
            continue

        result_lines.append(line)

    output = "\n".join(result_lines)

    # Bold: **text**
    output = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", output)
    # Italic: *text* (but not inside **)
    output = re.sub(r"(?<!\*)\*([^*]+?)\*(?!\*)", r"<em>\1</em>", output)
    # Inline code: `text`
    output = re.sub(r"`([^`]+?)`", r"<code>\1</code>", output)

    # Newlines to <br> (but not after block elements)
    output = re.sub(r"\n(?!<h[2-4]|<hr)", "<br>\n", output)

    return output


def generate_html(data):
    """Build a complete self-contained HTML string from benchmark data."""
    scenario = data.get("scenario", "Unknown")
    description = data.get("description", "")
    timestamp = data.get("timestamp", "")
    turns = data.get("turns", [])

    # Compute summary stats
    total_a = sum(t["response_a"].get("elapsed_seconds", 0) for t in turns)
    total_b = sum(t["response_b"].get("elapsed_seconds", 0) for t in turns)
    errors_a = sum(1 for t in turns if t["response_a"].get("error"))
    errors_b = sum(1 for t in turns if t["response_b"].get("error"))

    turn_type_counts = {"store": 0, "query": 0, "story": 0}
    for t in turns:
        turn_type_counts[classify_turn(t["prompt"])] += 1

    # Build turn HTML
    turns_html = []
    for t in turns:
        turn_num = t["turn"]
        prompt = t["prompt"]
        resp_a = t["response_a"]
        resp_b = t["response_b"]
        turn_type = classify_turn(prompt)

        # Determine collapse state
        collapsed = turn_type == "story"
        open_attr = "" if collapsed else " open"

        # Build response content for A
        content_a = _render_response(resp_a)
        # Build response content for B
        content_b = _render_response(resp_b)

        # Preview text (first ~120 chars of parsed response)
        preview_a = _preview(resp_a)
        preview_b = _preview(resp_b)

        # Type badge
        badge_class = f"badge-{turn_type}"
        badge_label = turn_type.upper()

        elapsed_a = resp_a.get("elapsed_seconds", 0)
        elapsed_b = resp_b.get("elapsed_seconds", 0)

        turn_html = f"""
    <div class="turn" style="content-visibility: auto;">
      <div class="prompt-row">
        <div class="prompt-header">
          <span class="turn-number">Turn {turn_num}</span>
          <span class="badge {badge_class}">{badge_label}</span>
        </div>
        <div class="prompt-text">{render_markdown(prompt)}</div>
      </div>
      <div class="response-grid">
        <div class="response-card response-a">
          <details{open_attr}>
            <summary>
              <span class="profile-label">A (Memory Files)</span>
              <span class="elapsed">{elapsed_a}s</span>
              {_status_indicator(resp_a)}
              <span class="preview">{html.escape(preview_a)}</span>
            </summary>
            <div class="response-body">{content_a}</div>
          </details>
        </div>
        <div class="response-card response-b">
          <details{open_attr}>
            <summary>
              <span class="profile-label">B (mem9)</span>
              <span class="elapsed">{elapsed_b}s</span>
              {_status_indicator(resp_b)}
              <span class="preview">{html.escape(preview_b)}</span>
            </summary>
            <div class="response-body">{content_b}</div>
          </details>
        </div>
      </div>
    </div>"""
        turns_html.append(turn_html)

    all_turns = "\n".join(turns_html)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Benchmark Report: {html.escape(scenario)}</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

  body {{
    background: #0a0a0a;
    color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    padding: 2rem 1rem;
  }}

  .container {{
    max-width: 1200px;
    margin: 0 auto;
  }}

  /* Header */
  .header {{
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid #222222;
  }}
  .header h1 {{
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #ffffff;
  }}
  .header .description {{
    color: #888888;
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }}
  .header .timestamp {{
    color: #666666;
    font-size: 0.8rem;
  }}

  /* Summary stats */
  .stats {{
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin: 1rem 0;
  }}
  .stat-card {{
    background: #111111;
    border: 1px solid #222222;
    border-radius: 8px;
    padding: 0.75rem 1rem;
    min-width: 140px;
  }}
  .stat-card .stat-label {{
    font-size: 0.75rem;
    color: #888888;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }}
  .stat-card .stat-value {{
    font-size: 1.2rem;
    font-weight: 600;
    color: #e0e0e0;
  }}

  /* Legend */
  .legend {{
    display: flex;
    gap: 1.5rem;
    margin: 1rem 0;
    font-size: 0.85rem;
  }}
  .legend-item {{
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }}
  .legend-swatch {{
    width: 12px;
    height: 12px;
    border-radius: 3px;
    display: inline-block;
  }}
  .swatch-prompt {{ background: #3b82f6; }}
  .swatch-a {{ background: #ef4444; }}
  .swatch-b {{ background: #22c55e; }}

  /* Turn */
  .turn {{
    margin-bottom: 1.5rem;
  }}

  /* Prompt row */
  .prompt-row {{
    background: #111111;
    border: 1px solid #222222;
    border-left: 3px solid #3b82f6;
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 0.5rem;
  }}
  .prompt-header {{
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }}
  .turn-number {{
    font-size: 0.8rem;
    font-weight: 600;
    color: #888888;
  }}
  .badge {{
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
  }}
  .badge-store {{ background: #1e3a5f; color: #60a5fa; }}
  .badge-query {{ background: #3b1f4f; color: #c084fc; }}
  .badge-story {{ background: #1a3a2a; color: #4ade80; }}
  .prompt-text {{
    font-size: 0.9rem;
    word-break: break-word;
  }}

  /* Response grid */
  .response-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }}
  @media (max-width: 768px) {{
    .response-grid {{ grid-template-columns: 1fr; }}
  }}

  /* Response cards */
  .response-card {{
    background: #111111;
    border: 1px solid #222222;
    border-radius: 8px;
    overflow: hidden;
  }}
  .response-a {{ border-left: 3px solid #ef4444; }}
  .response-b {{ border-left: 3px solid #22c55e; }}

  details {{
    width: 100%;
  }}
  summary {{
    cursor: pointer;
    padding: 0.75rem 1rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    user-select: none;
    list-style: none;
  }}
  summary::-webkit-details-marker {{ display: none; }}
  summary::before {{
    content: "\\25B6";
    font-size: 0.6rem;
    color: #888888;
    transition: transform 0.15s;
  }}
  details[open] > summary::before {{
    transform: rotate(90deg);
  }}

  .profile-label {{
    font-weight: 600;
    font-size: 0.8rem;
  }}
  .response-a .profile-label {{ color: #ef4444; }}
  .response-b .profile-label {{ color: #22c55e; }}

  .elapsed {{
    font-size: 0.75rem;
    color: #888888;
    background: #1a1a1a;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
  }}

  .preview {{
    color: #666666;
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }}

  .warning-indicator {{
    color: #f59e0b;
    font-size: 0.8rem;
  }}

  .response-body {{
    padding: 0.75rem 1rem;
    border-top: 1px solid #222222;
    font-size: 0.85rem;
    word-break: break-word;
    line-height: 1.7;
  }}
  .response-body h2 {{ font-size: 1.1rem; margin: 0.75rem 0 0.25rem; color: #ffffff; }}
  .response-body h3 {{ font-size: 1rem; margin: 0.5rem 0 0.25rem; color: #ffffff; }}
  .response-body h4 {{ font-size: 0.9rem; margin: 0.5rem 0 0.25rem; color: #ffffff; }}
  .response-body hr {{ border: none; border-top: 1px solid #333; margin: 0.75rem 0; }}
  .response-body strong {{ color: #ffffff; }}
  .response-body code {{
    background: #1a1a1a;
    padding: 0.15rem 0.35rem;
    border-radius: 3px;
    font-size: 0.8rem;
    color: #c084fc;
  }}

  .error-box {{
    background: #2d1212;
    border: 1px solid #ef4444;
    border-radius: 6px;
    padding: 0.75rem;
    color: #fca5a5;
    font-size: 0.85rem;
    word-break: break-word;
  }}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>{html.escape(scenario)}</h1>
    <div class="description">{html.escape(description)}</div>
    <div class="timestamp">{html.escape(timestamp)}</div>

    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Total Turns</div>
        <div class="stat-value">{len(turns)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Store</div>
        <div class="stat-value">{turn_type_counts['store']}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Query</div>
        <div class="stat-value">{turn_type_counts['query']}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Story</div>
        <div class="stat-value">{turn_type_counts['story']}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Time A</div>
        <div class="stat-value">{total_a:.1f}s</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Time B</div>
        <div class="stat-value">{total_b:.1f}s</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Errors A / B</div>
        <div class="stat-value">{errors_a} / {errors_b}</div>
      </div>
    </div>

    <div class="legend">
      <div class="legend-item"><span class="legend-swatch swatch-prompt"></span> Prompt</div>
      <div class="legend-item"><span class="legend-swatch swatch-a"></span> Profile A (Baseline)</div>
      <div class="legend-item"><span class="legend-swatch swatch-b"></span> Profile B (Treatment)</div>
    </div>
  </div>

{all_turns}

</div>
</body>
</html>"""


def _render_response(resp):
    """Render a single response dict to HTML content."""
    error = resp.get("error")
    if error:
        return f'<div class="error-box">{html.escape(error)}</div>'

    parsed = resp.get("parsed_response", "")
    if not parsed or not parsed.strip():
        return "<em>(no response)</em>"

    return render_markdown(parsed)


def _preview(resp):
    """Return a short preview string for the summary line."""
    error = resp.get("error")
    if error:
        return f"ERROR: {error[:100]}"

    parsed = resp.get("parsed_response", "")
    if not parsed or not parsed.strip():
        return "(no response)"

    # Flatten to single line, truncate
    flat = " ".join(parsed.split())
    if len(flat) > 120:
        return flat[:120] + "..."
    return flat


def _status_indicator(resp):
    """Return a warning indicator if returncode != 0."""
    if resp.get("error"):
        return '<span class="warning-indicator" title="Error">&#9888;</span>'
    if resp.get("returncode", 0) != 0:
        return '<span class="warning-indicator" title="Non-zero exit code">&#9888;</span>'
    return ""


def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <benchmark-results.json>", file=sys.stderr)
        sys.exit(1)

    path = sys.argv[1]
    with open(path) as f:
        data = json.load(f)

    print(generate_html(data))


if __name__ == "__main__":
    main()
