/**
 * The home's icon in Paseo's sidebar: Lucide's ship — the plugin's own sidebar
 * icon, ISC-licensed — in white on a blue rounded square.
 *
 * It is a file in the home, `icon.svg`, not something the plugin sets: Paseo
 * looks for an icon in every project's folder on its own (`favicon.svg`,
 * `icon.svg`, `icon.png` and more, square and 32 KB at most; an SVG counts as
 * square) and shows it unless the captain has uploaded one in the project's
 * settings. Written only when missing, so the captain can replace it.
 */
export const HOME_ICON_FILE = "icon.svg";

export const HOME_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#1d4ed8"/>
  <g transform="translate(22 22) scale(3.5)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 10.189V14"/>
    <path d="M12 2v3"/>
    <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/>
    <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76"/>
    <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
  </g>
</svg>
`;
