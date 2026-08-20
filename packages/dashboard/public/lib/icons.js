/**
 * Catálogo de ícones — traços de 24×24, `stroke: currentColor`.
 *
 * São constantes deste arquivo, nunca dado da API: é por isso que `svg()`
 * pode usar `innerHTML` neles sem abrir superfície de injeção.
 */
export const ICONS = {
  gauge: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="m14.1 9.9 3.4-3.4"/><path d="M3.3 17A9 9 0 1 1 20.7 17"/>',
  columns: '<rect x="3" y="4" width="6" height="16" rx="1.5"/><rect x="11" y="4" width="6" height="10" rx="1.5"/><path d="M19 4h2v16h-2z"/>',
  checklist: '<path d="m3 6 2 2 3-3"/><path d="m3 14 2 2 3-3"/><path d="M12 7h9"/><path d="M12 15h9"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  sliders: '<path d="M4 6h10"/><path d="M18 6h2"/><path d="M4 12h4"/><path d="M12 12h8"/><path d="M4 18h10"/><path d="M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  badge: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M14.5 9.5a2.5 2.5 0 0 0-2.5-1.5c-1.4 0-2.5.8-2.5 2s1.1 2 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2a2.5 2.5 0 0 1-2.5-1.5"/>',
  branch: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7"/><path d="M18 11.5c0 3-3 3.5-6 4"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  pulse: '<path d="M20.5 10.5c0 5-8.5 9.5-8.5 9.5s-8.5-4.5-8.5-9.5A4.5 4.5 0 0 1 12 7.8a4.5 4.5 0 0 1 8.5 2.7Z"/><path d="M3.5 12.5H8l1.5-2.5 2 4 1.5-2h5.5"/>',
  hand: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M15 11V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-3.5a1.5 1.5 0 0 1 3 0V13"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  x: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
  check: '<path d="m5 12 5 5 9-11"/>',
  alert: '<path d="M12 4 2.7 20h18.6L12 4Z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/>',
  inbox: '<path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M5.5 5h13l2.5 8v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4l2.5-8Z"/>',
  play: '<path d="M8 5.5v13l10-6.5-10-6.5Z"/>',
  pause: '<path d="M9 5v14"/><path d="M15 5v14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4"/><path d="M14 3v4"/><path d="M10 17v4"/><path d="M14 17v4"/><path d="M3 10h4"/><path d="M3 14h4"/><path d="M17 10h4"/><path d="M17 14h4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-13.7-5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 13.7 5L20 16"/><path d="M20 20v-4h-4"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="m14 6 4 4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  spark: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="m5.6 5.6 2.8 2.8"/><path d="m15.6 15.6 2.8 2.8"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m5.6 18.4 2.8-2.8"/><path d="m15.6 8.4 2.8-2.8"/>',
  logo: '<circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="9.5" ry="3.4" transform="rotate(-24 12 12)"/>',
  network: '<circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="19" r="2.2"/><circle cx="19" cy="19" r="2.2"/><path d="M12 7.2v6"/><path d="m10.5 13.5-4 4"/><path d="m13.5 13.5 4 4"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  terminal: '<path d="m5 7 5 5-5 5"/><path d="M12 19h7"/>',
  minus: '<path d="M5 12h14"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/>',
  expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>',
}

export function icon(name) {
  return ICONS[name] ?? ICONS.layers
}
