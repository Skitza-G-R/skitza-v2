# /get-started landing assets

Pre-launch placeholders. Replace with the real recordings before paid traffic.

## Required files (founder-owned)

| File | Purpose | Notes |
| --- | --- | --- |
| `demo.webm` | 15s demo loop (preferred codec) | muted, autoplay, looping. Phone-shape (9:16). |
| `demo.mp4` | Same loop, MP4 fallback for Safari/older browsers | |
| `demo-poster.jpg` | First-frame poster shown until the source loads | Same aspect, ~80–120 KB JPEG. |
| `founder.jpg` | Headshot for the founder section | Square. ~400×400. |

## How the section behaves until assets land

Without `demo.webm`/`demo.mp4` the `<video>` element renders the poster
(or, if no poster is present, an empty phone-frame). The component
continues to lazy-load via IntersectionObserver — no network requests
fire until the user scrolls within 200 px of the section.
