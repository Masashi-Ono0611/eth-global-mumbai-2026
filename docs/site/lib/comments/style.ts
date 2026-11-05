export const css = `
  .cm-host { position: relative; }
  .cm-btn { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border-radius: 999px; border: 1px solid var(--line, #ddd);
    background: var(--card, #fff); color: var(--ink, #111); font: 13px/26px system-ui, sans-serif; text-align: center; cursor: pointer; padding: 0;
    opacity: 0; transition: opacity .12s; z-index: 5; }
  .cm-host:hover > .cm-btn, .cm-btn.cm-has, .cm-btn:focus-visible { opacity: 1; }
  .cm-btn.cm-has { background: var(--duck, #f5b700); color: #1d1b16; border-color: transparent; font-weight: 700; }
  td.cm-host > .cm-btn { top: 50%; transform: translateY(-50%); }
  .diagram.cm-host > .cm-btn { right: auto; left: 6px; } /* Pele's zoom controls sit top-right */
  @media (hover: none) { .cm-btn { opacity: .55; } }
  .diagram.cm-host :is(.pele-node, .pele-cluster, .pele-edge-label, .pele-message) { cursor: pointer; }
  .diagram.cm-host :is(.pele-node, .pele-edge-label, .pele-message):hover { filter: drop-shadow(0 0 3px var(--arc, #2f6bff)); }
  .cm-mark { background: color-mix(in srgb, var(--duck, #f5b700) 38%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; cursor: pointer; }
  .cm-sel { position: absolute; z-index: 45; border: 0; border-radius: 999px; padding: 6px 10px; background: var(--ink, #111); color: var(--bg, #fff);
    font: 600 12px system-ui, sans-serif; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.2); display: none; }
  .cm-pop { position: absolute; z-index: 50; width: min(380px, 92vw); background: var(--card, #fff); color: var(--ink, #111);
    border: 1px solid var(--line, #ddd); border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.18); padding: 12px; font: 14px/1.45 system-ui, sans-serif; }
  .cm-pop { max-height: 70vh; overflow: auto; }
  .cm-pop h4 { margin: 0 0 8px; font-size: 12px; color: var(--muted, #666); font-weight: 600; }
  .cm-item { border-top: 1px solid var(--line, #eee); padding: 8px 0; white-space: pre-wrap; word-break: break-word; }
  .cm-meta { color: var(--muted, #666); font-size: 12px; margin-bottom: 2px; display: flex; justify-content: space-between; gap: 8px; }
  .cm-del { border: 0; background: none; color: var(--muted, #888); cursor: pointer; font-size: 12px; padding: 0; }
  .cm-pop textarea, .cm-pop input { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 8px; border-radius: 8px;
    border: 1px solid var(--line, #ccc); background: var(--bg, #fff); color: inherit; font: inherit; }
  .cm-pop textarea { min-height: 72px; resize: vertical; }
  .cm-row { display: flex; gap: 8px; margin-top: 8px; align-items: center; justify-content: space-between; }
  .cm-row button { padding: 7px 12px; border-radius: 8px; border: 0; background: var(--arc, #2f6bff); color: #fff; font: 600 13px system-ui, sans-serif; cursor: pointer; }
  .cm-row .cm-ghost { background: none; color: var(--muted, #666); border: 1px solid var(--line, #ccc); }
  .cm-err { color: var(--deny, #d64545); font-size: 12px; margin-top: 6px; }
  .cm-fab { position: fixed; right: 16px; bottom: 16px; z-index: 40; border: 0; border-radius: 999px; padding: 10px 14px;
    background: var(--ink, #111); color: var(--bg, #fff); font: 600 13px system-ui, sans-serif; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.2); }
  .cm-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); z-index: 60; overflow: auto; padding: 16px; box-sizing: border-box;
    background: var(--card, #fff); color: var(--ink, #111); border-left: 1px solid var(--line, #ddd); box-shadow: -12px 0 40px rgba(0,0,0,.15);
    font: 14px/1.45 system-ui, sans-serif; }
  .cm-panel h3 { margin: 18px 0 6px; font-size: 13px; }
  .cm-panel a { color: var(--arc, #2f6bff); cursor: pointer; }
  .cm-thread { border-top: 1px solid var(--line, #eee); padding-top: 6px; margin-top: 6px; }
  .cm-thread-resolved, .cm-thread-accepted, .cm-thread-rejected { opacity: .7; }
  .cm-reply { margin-left: 14px; padding-left: 10px; border-left: 2px solid var(--line, #ddd); border-top: 0; }
  .cm-body { white-space: pre-wrap; word-break: break-word; }
  .cm-actions { display: inline-flex; gap: 10px; }
  .cm-link { border: 0; background: none; color: var(--arc, #2f6bff); cursor: pointer; font: 600 12px system-ui, sans-serif; padding: 0; }
  .cm-status { display: flex; gap: 12px; align-items: center; font-size: 12px; margin: 2px 0 4px; }
  .cm-chip { font: 600 11px system-ui, sans-serif; padding: 2px 8px; border-radius: 999px; background: var(--line, #eee); }
  .cm-accepted, .cm-resolved { background: color-mix(in srgb, var(--ok, #1f9d55) 22%, transparent); }
  .cm-rejected { background: color-mix(in srgb, var(--deny, #d64545) 22%, transparent); }
  .cm-toggle { display: block; margin: 8px 0; }
  .cm-btn.cm-done { opacity: 1; color: var(--ok, #1f9d55); font-weight: 700; }
  .cm-form { margin-top: 8px; }
  .cm-quote { color: var(--muted, #666); font-size: 12px; border-left: 3px solid var(--line, #ddd); padding-left: 8px; margin: 12px 0 2px; }
`
