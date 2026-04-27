// lib/sentre.ts
//
// Komplett liste over NAF-sentre. Kilde:
// https://www.autolease.no/media/42fbhjnf/naf-senterliste.pdf (per april 2026, 44 sentre)
//
// Brukes som eneste kilde i registrerings-skjema, ny-reklamasjon-skjema, og adminpanel.
// Nye sentre legges inn alfabetisk her.

export const NAF_SENTRE = [
  'NAF Senter Alta',         'NAF Senter Arendal',      'NAF Senter Bodø',
  'NAF Senter Drammen',      'NAF Senter Elverum',      'NAF Senter Finnsnes',
  'NAF Senter Fredrikstad',  'NAF Senter Fyllingsdalen','NAF Senter Førde',
  'NAF Senter Gjøvik',       'NAF Senter Halden',       'NAF Senter Hamar',
  'NAF Senter Harstad',      'NAF Senter Haugesund',    'NAF Senter Hvam',
  'NAF Senter Jessheim',     'NAF Senter Knarvik',      'NAF Senter Kongsberg',
  'NAF Senter Kristiansand', 'NAF Senter Kristiansund', 'NAF Senter Larvik',
  'NAF Senter Levanger',     'NAF Senter Lillehammer',  'NAF Senter Lillestrøm',
  'NAF Senter Mastemyr',     'NAF Senter Mo i Rana',    'NAF Senter Molde',
  'NAF Senter Mosjøen',      'NAF Senter Moss',         'NAF Senter Namsos',
  'NAF Senter Narvik',       'NAF Senter Oslo',         'NAF Senter Otta',
  'NAF Senter Sandvika',     'NAF Senter Skien',        'NAF Senter Sortland',
  'NAF Senter Stavanger',    'NAF Senter Steinkjer',    'NAF Senter Stjørdal',
  'NAF Senter Tromsø',       'NAF Senter Trondheim',    'NAF Senter Tønsberg',
  'NAF Senter Ålesund',      'NAF Senter Åsane',
] as const;

export type NafSenter = typeof NAF_SENTRE[number];
