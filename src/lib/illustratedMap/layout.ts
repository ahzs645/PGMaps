/**
 * Authored schematic, in the reference's 1536 x 945 artboard coordinates.
 * Curves are constructed from chosen landmarks. No coastline/road contour is imported or traced.
 * These coordinates are illustration positions, never longitude/latitude or routing data.
 */
export type Point = readonly [number, number]
export const ARTBOARD = { width: 1536, height: 945 } as const
export const MAP_PALETTE = {
  canopy: '#00392F',
  emerald: '#1A7667',
  moss: '#B0BD36',
  hatch: '#BCC454',
  ocean: '#D6DFDE',
  surrounding: '#E6E7E8',
  paper: '#FFFFFF',
  pin: '#AF5045',
} as const

export const MAINLAND =
  'M0 0H752 C792 24 816 54 837 87 C850 117 853 146 875 164 C900 188 922 190 949 214 C979 244 1005 247 1034 265 C1082 296 1093 331 1127 366 C1165 403 1217 421 1244 452 C1277 484 1295 511 1302 548 C1308 590 1305 629 1329 668 C1356 713 1404 741 1431 771 C1445 787 1448 806 1424 811 C1370 814 1181 815 1050 815 L451 817 C425 796 391 782 367 768 C339 748 313 718 284 700 C251 676 226 659 207 627 C178 579 166 545 128 516 C88 481 38 458 0 448Z'

export const FOREST_MAINLAND =
  'M0 0H756 C753 28 746 44 747 76 C751 106 765 130 760 160 C752 185 737 205 723 229 C710 253 718 285 699 310 C674 325 663 319 644 343 C629 365 616 366 596 368 C570 361 562 389 542 389 C523 387 512 405 495 411 C472 423 467 448 441 460 C421 466 413 487 397 497 C389 526 389 556 372 577 C354 596 333 610 312 629 C293 649 277 661 260 673 C233 654 220 638 206 612 C179 559 155 532 127 515 C89 480 40 459 0 448Z'

export const VANCOUVER_ISLAND =
  'M0 545 C22 557 40 572 58 594 C91 623 102 659 134 682 C159 705 176 728 211 746 C239 760 263 781 281 809 C300 836 298 860 317 883 C331 900 332 915 324 927 C309 936 290 929 273 923 C233 909 211 888 184 872 C156 849 127 834 103 814 C76 792 55 777 33 752 C8 727 1 710 0 699Z'

export const OCEAN =
  'M0 447 C41 458 87 484 130 516 C165 544 179 581 206 627 C227 663 259 682 288 703 C320 723 337 750 367 770 C410 798 444 817 465 851 C484 881 491 915 492 945H0Z'

/** Catmull-Rom interpolation gives each authored route a smooth, editable cubic centreline. */
export function smoothPath(points: readonly Point[], tension = 0.65): string {
  if (!points.length) return ''
  const f = (n: number) => Number(n.toFixed(2))
  let d = `M${points[0][0]} ${points[0][1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)]
    const b = points[i]
    const c = points[i + 1]
    const e = points[Math.min(points.length - 1, i + 2)]
    const k = tension / 6
    d += `C${f(b[0] + (c[0] - a[0]) * k)} ${f(b[1] + (c[1] - a[1]) * k)} ${f(c[0] - (e[0] - b[0]) * k)} ${f(c[1] - (e[1] - b[1]) * k)} ${c[0]} ${c[1]}`
  }
  return d
}

// All meeting routes share these objects, so their junctions cannot drift apart.
export const JUNCTIONS = {
  vancouver: [400, 757],
  hope: [585, 748],
  lillooet: [600, 485],
  kamloops: [703, 522],
  golden: [1143, 392],
  robson: [831, 94],
  fernie: [1313, 712],
  seattleExit: [493, 805],
  goldenSouthLink: [1086, 396],
  mountainLoop: [1160, 598],
  southernLoop: [943, 743],
} as const satisfies Record<string, Point>

export type AuthoredRoute = { id: string; title: string; points: readonly Point[] }
export const HIGHWAYS: readonly AuthoredRoute[] = [
  {
    id: 'highway-99',
    title: 'Highway 99: Vancouver to the northern junction',
    points: [
      JUNCTIONS.vancouver,
      [378, 748],
      [382, 709],
      [392, 680],
      [390, 651],
      [409, 622],
      [423, 618],
      [422, 592],
      [451, 585],
      [461, 574],
      [477, 575],
      [495, 545],
      [509, 533],
      [510, 522],
      [527, 507],
      [536, 487],
      [540, 477],
      [559, 497],
      [570, 482],
      [581, 483],
      JUNCTIONS.lillooet,
    ],
  },
  {
    id: 'highway-1-west',
    title: 'Highway 1: Vancouver, Hope and the northern junction',
    points: [
      JUNCTIONS.vancouver,
      [420, 771],
      [440, 779],
      [460, 790],
      [476, 802],
      JUNCTIONS.seattleExit,
      [510, 791],
      [542, 786],
      [554, 778],
      [560, 758],
      JUNCTIONS.hope,
      [585, 721],
      [583, 686],
      [582, 659],
      [574, 636],
      [573, 612],
      [576, 592],
      [575, 579],
      [598, 563],
      [600, 545],
      [593, 528],
      [592, 511],
      JUNCTIONS.lillooet,
    ],
  },
  {
    id: 'highway-1-east',
    title: 'Highway 1: northern junction, Kamloops and Golden',
    points: [
      JUNCTIONS.lillooet,
      [618, 498],
      [641, 502],
      [665, 505],
      [681, 516],
      JUNCTIONS.kamloops,
      [747, 523],
      [775, 490],
      [787, 485],
      [808, 488],
      [820, 493],
      [822, 520],
      [850, 502],
      [872, 484],
      [898, 465],
      [915, 471],
      [932, 478],
      [952, 460],
      [971, 460],
      [994, 440],
      [1010, 421],
      [1025, 415],
      [1036, 403],
      [1035, 390],
      [1029, 375],
      [1035, 373],
      [1058, 379],
      [1075, 388],
      JUNCTIONS.goldenSouthLink,
      [1106, 409],
      [1132, 420],
      JUNCTIONS.golden,
    ],
  },
  {
    id: 'highway-5-north',
    title: 'Highway 5: Kamloops to Mount Robson',
    points: [
      JUNCTIONS.kamloops,
      [711, 498],
      [718, 477],
      [720, 458],
      [733, 440],
      [728, 418],
      [726, 400],
      [724, 382],
      [727, 366],
      [728, 352],
      [742, 341],
      [761, 352],
      [779, 355],
      [785, 342],
      [805, 341],
      [817, 331],
      [826, 306],
      [826, 290],
      [820, 272],
      [822, 251],
      [835, 234],
      [837, 212],
      [844, 190],
      [843, 176],
      [832, 161],
      [828, 145],
      [831, 127],
      [819, 107],
      [813, 101],
      JUNCTIONS.robson,
    ],
  },
  {
    id: 'highway-5-south',
    title: 'Highway 5: Hope to Kamloops',
    points: [
      JUNCTIONS.hope,
      [600, 729],
      [608, 714],
      [630, 703],
      [631, 681],
      [643, 666],
      [642, 639],
      [658, 621],
      [662, 599],
      [677, 584],
      [677, 562],
      [690, 545],
      JUNCTIONS.kamloops,
    ],
  },
  {
    id: 'highway-3',
    title: 'Southern routes: Hope to Fernie',
    points: [
      JUNCTIONS.hope,
      [617, 772],
      [629, 775],
      [645, 788],
      [663, 803],
      [675, 789],
      [684, 780],
      [680, 766],
      [684, 742],
      [691, 732],
      [706, 733],
      [726, 743],
      [747, 748],
      [758, 767],
      [773, 778],
      [778, 788],
      [782, 806],
      [789, 797],
      [807, 809],
      [840, 809],
      [866, 803],
      [891, 811],
      [896, 795],
      [911, 787],
      [915, 806],
      [939, 811],
      [948, 804],
      [947, 783],
      [957, 776],
      [961, 767],
      [978, 768],
      [990, 762],
      [1016, 776],
      [1044, 781],
      [1048, 798],
      [1056, 805],
      [1074, 800],
      [1091, 790],
      [1112, 787],
      [1139, 793],
      [1160, 786],
      [1184, 798],
      [1193, 782],
      [1212, 769],
      [1228, 754],
      [1238, 738],
      [1234, 726],
      [1249, 710],
      [1260, 723],
      [1285, 749],
      [1296, 745],
      [1306, 762],
      [1316, 760],
      [1308, 737],
      JUNCTIONS.fernie,
    ],
  },
]

export const CONNECTORS: readonly AuthoredRoute[] = [
  { id: 'to-jasper', title: 'Jasper and Edmonton continuation', points: [JUNCTIONS.robson, [887, 93], [956, 93]] },
  {
    id: 'robson-golden',
    title: 'Eastern continuation',
    points: [
      JUNCTIONS.robson,
      [881, 97],
      [918, 112],
      [941, 138],
      [985, 157],
      [996, 199],
      [1017, 222],
      [1062, 244],
      [1100, 277],
      [1127, 319],
      JUNCTIONS.golden,
    ],
  },
  {
    id: 'to-banff',
    title: 'Banff and Calgary continuation',
    points: [JUNCTIONS.golden, [1176, 386], [1204, 402], [1237, 415], [1270, 412], [1301, 432], [1403, 431]],
  },
  {
    id: 'east-mountain-loop',
    title: 'Mountain loop',
    points: [[1209, 401], [1200, 445], [1194, 513], [1187, 555], JUNCTIONS.mountainLoop],
  },
  {
    id: 'golden-fernie',
    title: 'Golden to southern route connector',
    points: [
      JUNCTIONS.goldenSouthLink,
      [1112, 451],
      [1108, 490],
      [1120, 535],
      JUNCTIONS.mountainLoop,
      [1200, 674],
      [1235, 717],
    ],
  },
  {
    id: 'kamloops-south',
    title: 'Interior south connector',
    points: [
      [823, 523],
      [834, 558],
      [834, 606],
      [828, 657],
      [811, 718],
      [795, 766],
      [783, 786],
    ],
  },
  {
    id: 'west-connector',
    title: 'Western scenic connector',
    points: [JUNCTIONS.lillooet, [612, 441], [622, 456], [670, 474], [716, 468]],
  },
  {
    id: 'south-loop',
    title: 'Southern scenic connector',
    points: [[891, 806], [919, 763], JUNCTIONS.southernLoop, [989, 726], [1036, 722], [1037, 778]],
  },
  {
    id: 'south-loop-short',
    title: 'Southern short connector',
    points: [[912, 805], [925, 813], [940, 802], JUNCTIONS.southernLoop],
  },
  {
    id: 'to-seattle',
    title: 'Seattle continuation',
    points: [JUNCTIONS.seattleExit, [514, 863]],
  },
]

export const MAP_LABELS: readonly {
  id: string
  text: string
  box: readonly [number, number, number, number]
  face?: 'regular' | 'smallcaps'
}[] = [
  { id: 'mount', text: 'MOUNT', box: [738, 52, 75, 13] },
  { id: 'robson', text: 'ROBSON', box: [733, 70, 84, 13] },
  { id: 'jasper', text: 'JASPER &', box: [906, 46, 109, 13] },
  { id: 'edmonton', text: 'EDMONTON', box: [896, 65, 126, 13] },
  { id: 'alberta', text: 'ALBERTA', box: [1273, 286, 102, 13] },
  { id: 'banff', text: 'BANFF &', box: [1310, 384, 96, 13] },
  { id: 'calgary', text: 'CALGARY', box: [1308, 402, 101, 13] },
  { id: 'golden', text: 'GOLDEN', box: [1037, 386, 88, 13] },
  { id: 'kamloops', text: 'KAMLOOPS', box: [706, 533, 124, 13] },
  { id: 'fernie', text: 'FERNIE', box: [1331, 705, 84, 13] },
  { id: 'vancouver', text: 'VANCOUVER', box: [283, 786, 134, 13] },
  { id: 'seattle', text: 'SEATTLE', box: [510, 868, 100, 13] },
  { id: 'usa', text: 'USA', box: [959, 876, 47, 13] },
  { id: 'victoria', text: 'VICTORIA', box: [301, 910, 113, 13] },
  { id: 'mile-zero', text: 'MILE 0', box: [331, 884, 81, 13] },
  { id: 'rainforest', text: 'RAINFOREST', box: [126, 684, 232, 36], face: 'regular' },
  { id: 'canadian', text: 'CANADIAN', box: [1236, 535, 174, 36], face: 'regular' },
  { id: 'rockies', text: 'ROCKIES', box: [1247, 579, 152, 36], face: 'regular' },
]
