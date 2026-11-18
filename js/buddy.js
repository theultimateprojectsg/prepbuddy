// PrepBuddy's logo (the speech-bubble P) and Buddy, the character inside the app, as inline SVG.
// Buddy has four faces: happy (right answer, the coach), listen, think, done (well done!).

const P_PARTS = '<circle cx="53" cy="40" r="26" fill="#FFFFFF"/><path d="M27 40 H40 V73 L27 86 Z" fill="#FFFFFF"/><circle cx="53" cy="40" r="11" fill="#FFE066"/>';
// The logo on its navy tile; `bare` draws only the P, for navy backgrounds.
export function logoSVG(size = 28, bare = false, label = '') {
  const a = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" ${a} focusable="false">${bare ? '' : '<rect width="100" height="100" rx="24" fill="#26357A"/>'}${P_PARTS}</svg>`;
}

const BODY = '<path d="M50 14 C50 9 52 6 57 5 C57 10 54 13 50 14 Z" fill="#18966A"/><path d="M50 13 V17" stroke="#18966A" stroke-width="2.5" stroke-linecap="round"/><circle cx="50" cy="50" r="34" fill="#FFE066"/><path d="M26 70 L17 90 L40 81 Z" fill="#FFE066"/>';
const CHEEKS = '<ellipse cx="29" cy="60" rx="5.5" ry="3.4" fill="#FF8F8F" opacity="0.65"/><ellipse cx="71" cy="60" rx="5.5" ry="3.4" fill="#FF8F8F" opacity="0.65"/>';
const EYES = '<ellipse cx="38" cy="47" rx="6.5" ry="8" fill="#26357A"/><ellipse cx="62" cy="47" rx="6.5" ry="8" fill="#26357A"/><circle cx="40.5" cy="43.5" r="2.4" fill="#FFFFFF"/><circle cx="64.5" cy="43.5" r="2.4" fill="#FFFFFF"/>';
const FACES = {
  happy: BODY + CHEEKS + EYES + '<path d="M44 61 L49 66 L58 57" fill="none" stroke="#26357A" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>',
  listen: BODY + CHEEKS + EYES + '<ellipse cx="50" cy="63" rx="3.6" ry="4.6" fill="#26357A"/>',
  think: BODY + CHEEKS + '<ellipse cx="41" cy="44" rx="6" ry="7.5" fill="#26357A"/><ellipse cx="65" cy="44" rx="6" ry="7.5" fill="#26357A"/><circle cx="43.5" cy="40.5" r="2.2" fill="#FFFFFF"/><circle cx="67.5" cy="40.5" r="2.2" fill="#FFFFFF"/><path d="M44 62 Q51 67 58 61" fill="none" stroke="#26357A" stroke-width="4" stroke-linecap="round"/><circle cx="86" cy="24" r="3.2" fill="#26357A" opacity="0.45"/><circle cx="93" cy="15" r="2.2" fill="#26357A" opacity="0.35"/>',
  done: BODY + '<ellipse cx="29" cy="59" rx="6" ry="3.8" fill="#FF8F8F" opacity="0.8"/><ellipse cx="71" cy="59" rx="6" ry="3.8" fill="#FF8F8F" opacity="0.8"/><path d="M31 49 Q38 39 45 49 M55 49 Q62 39 69 49" fill="none" stroke="#26357A" stroke-width="4.5" stroke-linecap="round"/><path d="M41 58 Q50 72 59 58 Z" fill="#26357A"/><path d="M12 30 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 Z M86 44 l1.5 -4.5 l1.5 4.5 l4.5 1.5 l-4.5 1.5 l-1.5 4.5 l-1.5 -4.5 l-4.5 -1.5 Z" fill="#26357A" opacity="0.55"/>',
};
export const buddyFace = (kind) => FACES[kind] || FACES.happy;
export function buddySVG(kind = 'happy', size = 40, label = '') {
  const a = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="buddy" width="${size}" height="${size}" viewBox="0 0 100 100" ${a} focusable="false">${buddyFace(kind)}</svg>`;
}

// Buddy on a streak: gets more fired up the longer it runs (tier 1-4). Flame hair replaces the leaf; sunglasses from tier 3.
const FLAME = (sc, y) => `<g transform="translate(50 ${y}) scale(${sc}) translate(-20 -46)"><path class="bf-o" d="M20 2c3 9 14 15 14 29a14 14 0 0 1-28 0c0-7 4-11 7-15 0 5 2 8 5 9-2-8 0-15 2-23z" fill="url(#bfg)"/><path class="bf-i" d="M20 22c2 5 8 8 8 15a8 8 0 0 1-16 0c0-4 2-6 4-8 0 3 1 4 3 5-1-5 0-8 1-12z" fill="#FFF3B0"/></g>`;
const FBODY = '<circle cx="50" cy="52" r="34" fill="#FFE066"/><path d="M26 72 L17 92 L40 83 Z" fill="#FFE066"/>';
const SHADES = '<path d="M24 43 H76" stroke="#1E2A5A" stroke-width="3.5" stroke-linecap="round"/><path d="M26 43 h20 q0 12 -10 12 q-10 0 -10 -12z M54 43 h20 q0 12 -10 12 q-10 0 -10 -12z" fill="#1E2A5A"/><path d="M30 46 l5 -2 M58 46 l5 -2" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" opacity=".8"/>';
const FIRE_FACES = {
  1: FLAME(0.42, 22) + FBODY + CHEEKS + EYES.replace(/cy="47"/g, 'cy="49"').replace(/cy="43.5"/g, 'cy="45.5"') + '<path d="M42 63 Q50 71 58 63" fill="none" stroke="#26357A" stroke-width="4.5" stroke-linecap="round"/>',
  2: FLAME(0.6, 24) + FBODY + '<ellipse cx="29" cy="62" rx="6" ry="3.8" fill="#FF8F8F" opacity="0.8"/><ellipse cx="71" cy="62" rx="6" ry="3.8" fill="#FF8F8F" opacity="0.8"/><path d="M31 51 Q38 41 45 51 M55 51 Q62 41 69 51" fill="none" stroke="#26357A" stroke-width="4.5" stroke-linecap="round"/><path d="M40 60 Q50 74 60 60 Z" fill="#26357A"/>',
  3: FLAME(0.8, 26) + FBODY + '<ellipse cx="29" cy="63" rx="6" ry="3.8" fill="#FF8F8F" opacity="0.8"/><ellipse cx="71" cy="63" rx="6" ry="3.8" fill="#FF8F8F" opacity="0.8"/>' + SHADES + '<path d="M38 62 Q50 76 62 62 Z" fill="#26357A"/><path d="M44 64 h12" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>',
  4: FLAME(1.05, 28) + FBODY + '<ellipse cx="28" cy="63" rx="6.5" ry="4" fill="#FF7A7A" opacity="0.85"/><ellipse cx="72" cy="63" rx="6.5" ry="4" fill="#FF7A7A" opacity="0.85"/>' + SHADES + '<path d="M36 61 Q50 80 64 61 Z" fill="#26357A"/><path d="M42 63 h16" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/><path d="M8 34 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 Z M88 30 l1.8 -5 l1.8 5 l5 1.8 l-5 1.8 l-1.8 5 l-1.8 -5 l-5 -1.8 Z" fill="#FF9F1C"/>',
};
export function buddyFire(tier = 1, size = 40) {
  return `<svg class="buddy bud-fire bud-f${tier}" width="${size}" height="${size}" viewBox="0 -14 100 114" aria-hidden="true" focusable="false" style="overflow:visible"><defs><radialGradient id="bfg" cx="50%" cy="78%" r="70%"><stop offset="0" stop-color="#FFE27A"/><stop offset=".45" stop-color="#FF9F1C"/><stop offset="1" stop-color="#F0441F"/></radialGradient></defs>${FIRE_FACES[Math.min(4, Math.max(1, tier))]}</svg>`;
}
