# Bundled fonts

Self-hosted because the renderer CSP is `default-src 'self'` — no font CDN.

| File | Family | Axes | License |
| --- | --- | --- | --- |
| `archivo-latin-wdth-wght.woff2` | Archivo (Omnibus-Type) | `wdth` 62–125, `wght` 100–900 | SIL Open Font License 1.1 |
| `geist-latin-wght.woff2` | Geist (Vercel) | `wght` 100–900 | SIL Open Font License 1.1 |
| `ibm-plex-mono-*.woff2` | IBM Plex Mono | static 400 / 500 / 700 | SIL Open Font License 1.1 |

Archivo is the display face: the `wdth` axis is what makes the countdown read as a
panel readout rather than set type. Latin subset only (`U+0000-00FF` plus the usual
punctuation), pulled from the Google Fonts `css2` variable endpoint.
