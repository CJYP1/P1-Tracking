window.__RWS=window.__RWS||{};
// Floor templates for upper levels — geometry/quantities get pasted in per floor
// once the plan image is provided. Same schema as zone-data.js DATA.levels[*].
//
// TO FILL A FLOOR (e.g. 3F) after receiving its plan image:
//   1. Set title, w, h (drawing extents in the same units as the source plan).
//   2. Push zone objects into `zones` following the schema below.
//   3. Delete `_tpl:true` so the empty-state overlay stops showing.
//
// ZONE SCHEMA (matches existing floors):
//   { lid, fam, grp, ring:[[x,y],...], crit, n_acts, n_crit,
//     label, lx, ly, mk:'3F|<id>', cat:'EB'|'NB'|'MA',
//     area, counts:{columns,pilecap,mainbeam,steelbeam,liftcw,stair,liftstair},
//     cols:[{id,sz,c}], piles:[{id,rl}], beams:[{id,sz}],
//     lifts:[{id,f,t}], stairs:[{id,f,t}], cores:[...], sub:[{n,a}] }
//   cat drives the 三大区 grouping: EB=Existing Basement, NB=New Basement, MA=Marine.

const EMPTY_TOTALS = {columns:0,pilecap:0,mainbeam:0,steelbeam:0,liftcw:0,stair:0,liftstair:0,area:0};

window.__RWS.FLOOR_TEMPLATES = {
  order: ['3F', '4F', '5F'],
  levels: {
    '3F': { title: 'Level 3', w: 400987.0, h: 298476.7, zones: [], _tpl: true },
    '4F': { title: 'Level 4', w: 400987.0, h: 298476.7, zones: [], _tpl: true },
    '5F': { title: 'Level 5', w: 400987.0, h: 298476.7, zones: [], _tpl: true }
  },
  totals: EMPTY_TOTALS
};
