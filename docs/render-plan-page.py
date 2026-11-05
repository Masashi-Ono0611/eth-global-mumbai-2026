#!/usr/bin/env python3
"""Render docs/plan.md into the team site's plan page (docs/site/plan/index.html).

docs/plan.md stays the source of truth; the page is generated from it, styled like the architecture page, with a
table of contents, the Architecture | Plan tabs and the site's comment layer (page slug "plan").

Usage (from the repo root):  python3 docs/render-plan-page.py
Needs Bun (runs the pinned markdown converter `marked` via bunx; nothing is added to the repo's dependencies).
"""

import html
import pathlib
import re
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "plan.md"
ARCHITECTURE = ROOT / "docs" / "site" / "architecture" / "index.html"
TARGET = ROOT / "docs" / "site" / "plan" / "index.html"
MARKED = "marked@15.0.12"

TABS_CSS = """
  .tabs { display: flex; gap: 6px; margin: 0 0 22px; border-bottom: 1px solid var(--line); }
  .tabs a { padding: 8px 14px; border-radius: 10px 10px 0 0; text-decoration: none; color: var(--muted); font-weight: 600; }
  .tabs a[aria-current="page"] { color: var(--ink); background: var(--card); border: 1px solid var(--line); border-bottom-color: var(--card); margin-bottom: -1px; }
"""

PLAN_CSS = """
  .toc { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 18px; margin: 18px 0 8px; columns: 2; column-gap: 28px; }
  .toc a { display: block; padding: 2px 0; color: var(--ink); text-decoration: none; break-inside: avoid; }
  .toc a.h3 { padding-left: 14px; color: var(--muted); font-size: .92rem; }
  @media (max-width: 760px) { .toc { columns: 1; } }
  main h2 { scroll-margin-top: 16px; padding-top: 6px; border-top: 1px solid var(--line); }
  main h3 { margin: 28px 0 8px; scroll-margin-top: 16px; }
  main p, main li { max-width: 52rem; }
  main pre { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; overflow-x: auto; font: .85rem/1.5 ui-monospace, monospace; }
  main pre code { background: none; padding: 0; }
  main table { display: block; overflow-x: auto; }
  main ul ul { margin-top: 4px; }
"""


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"<[^>]+>", "", text).lower()).strip("-")[:60]


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp) / "plan.html"
        subprocess.run(["bunx", "--bun", MARKED, "--gfm", "-i", str(SOURCE), "-o", str(out)], check=True, cwd=tmp)
        body = out.read_text()

    style = re.search(r"<style>(.*?)</style>", ARCHITECTURE.read_text(), re.S).group(1)

    toc, used = [], set()

    def add_id(match: re.Match) -> str:
        level, inner = match.group(1), match.group(2)
        ident = slug(inner) or "section"
        while ident in used:
            ident += "-x"
        used.add(ident)
        label = html.unescape(re.sub(r"<[^>]+>", "", inner))
        toc.append(f'<a class="h{level}" href="#{ident}">{html.escape(label)}</a>')
        return f'<h{level} id="{ident}">{inner}</h{level}>'

    body = re.sub(r"<h([23])>(.*?)</h\1>", add_id, body)
    title_match = re.search(r"<h1>(.*?)</h1>", body)
    title = html.unescape(re.sub(r"<[^>]+>", "", title_match.group(1))) if title_match else "Plan"
    body = body.replace(title_match.group(0), title_match.group(0) + '\n<nav class="toc">' + "".join(toc) + "</nav>", 1) if title_match else body

    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} · ETHGlobal Mumbai 2026</title>
<!-- GENERATED from docs/plan.md by docs/render-plan-page.py; edit the markdown, then rerun the script. -->
<style>{style}{TABS_CSS}{PLAN_CSS}</style>
</head>
<body>
<main>
  <nav class="tabs"><a href="/architecture/">Architecture</a><a href="/plan/" aria-current="page">Plan</a></nav>
  <div class="kicker">ETHGlobal Mumbai 2026 · the plan in full (from docs/plan.md) · comment with 💬</div>
{body}
  <footer>Generated from <code>docs/plan.md</code> · diagrams on the <a href="/architecture/">Architecture</a> page ·
    <a href="https://github.com/grmkris/eth-global-mumbai-2026/blob/main/docs/plan.md">source on GitHub</a></footer>
</main>
<script src="/lib/comments.js" defer></script>
</body>
</html>
"""
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(page)
    print(f"wrote {TARGET.relative_to(ROOT)} ({len(page)} bytes, {len(toc)} toc entries)")


if __name__ == "__main__":
    main()
