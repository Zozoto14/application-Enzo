import{q as a,v as m}from"./ChampNote-B4cL0lGB.js";const d=`
#impression-esport { font: 12pt/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; background: #fff; padding: 0; }
#impression-esport h1 { font-size: 20pt; margin: 0 0 8pt; }
#impression-esport h2 { font-size: 15pt; margin: 14pt 0 4pt; }
#impression-esport h3 { font-size: 12.5pt; margin: 14pt 0 3pt; border-bottom: 1px solid #bbb; padding-bottom: 2pt; break-after: avoid; }
#impression-esport p, #impression-esport li { margin: 2pt 0; }
#impression-esport ul, #impression-esport ol { margin: 2pt 0 6pt; padding-left: 18pt; }
#impression-esport a { color: #1a4fc4; word-break: break-all; }
#impression-esport code { font-family: ui-monospace, Menlo, Consolas, monospace; background: #f1f1f1; padding: 0 2pt; }
#impression-esport blockquote { margin: 4pt 0; padding: 0 0 0 8pt; border-left: 3px solid #bbb; color: #444; }
#impression-esport pre { margin: 4pt 0; padding: 6pt; background: #f1f1f1; white-space: pre-wrap; word-break: break-word; }
#impression-esport pre code { padding: 0; }
#impression-esport hr { border: 0; border-top: 1px solid #bbb; margin: 8pt 0; }
#impression-esport mark { background: #fff1a8; }
#impression-esport .c-rouge { color: #c62828; } #impression-esport .c-orange { color: #d9660b; } #impression-esport .c-jaune { color: #8a6d00; }
#impression-esport .c-vert { color: #2e7d32; } #impression-esport .c-bleu { color: #1a4fc4; } #impression-esport .c-violet { color: #6a3fc4; }
#impression-esport .c-rose { color: #c2185b; } #impression-esport .c-gris { color: #666; }
#impression-esport h3, #impression-esport p, #impression-esport li { break-inside: avoid; }
@media screen { #impression-esport { display: none; } }
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(#impression-esport):not(style) { display: none !important; }
  #impression-esport { display: block; }
  @page { margin: 16mm; }
}`;function l(i,t){return`<article aria-label="${a(i)}">${m(t)}</article>`}const b=!0;async function f(i,t){const o=globalThis,e=o.document;if(!e||typeof o.print!="function")return!1;e.getElementById("impression-esport")?.remove(),e.getElementById("impression-esport-style")?.remove();const r=e.createElement("style");r.id="impression-esport-style",r.textContent=d;const s=e.createElement("div");s.id="impression-esport",s.innerHTML=l(i,t),e.head.appendChild(r),e.body.appendChild(s);const p=()=>{s.remove(),r.remove(),o.removeEventListener?.("afterprint",p)};return o.addEventListener?.("afterprint",p),await new Promise(n=>setTimeout(n,50)),o.print(),!0}export{b as a,f as i};
