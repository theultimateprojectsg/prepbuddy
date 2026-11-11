// PrepBuddy's logo (the speech-bubble P) and Buddy, the character inside the app, as inline SVG.
// Buddy has four faces: happy (right answer, the coach), listen, think, done (well done!).

const P_PARTS = '<circle cx="57" cy="44" r="26" fill="#FFFFFF"/><path d="M31 44 H44 V77 L31 90 Z" fill="#FFFFFF"/><circle cx="57" cy="44" r="11" fill="#FFE066"/>';
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
