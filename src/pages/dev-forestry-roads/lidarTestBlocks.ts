/**
 * Real BC blocks with LidarBC DEM tiles flown at a useful time, for testing the designer on LiDAR ground.
 *
 * Screened on 17 November 2026 from FTEN cutblocks and the LidarBC tile index (`docs/forestry-road-design/
 * lidar-test-blocks.md`, which says how and how to repeat it). Only identifiers and the screened dates are kept here;
 * opening a block reads its records live, so a block that has since changed opens as it now is or is refused.
 * The LiDAR years are what the index listed at the block's centre: confirm them with **Check LiDAR** or the terrain
 * dialog's LidarBC source, which also report whether the tiles hold elevations over the block.
 */

export type LidarTestCategory = 'planned' | 'before-after' | 'as-built'

export interface LidarTestBlock {
  id: string
  category: LidarTestCategory
  /** FTEN licence, cutting permit (when any) and block label, as reported. */
  licence: string
  cuttingPermit?: string
  block: string
  /** FTA administrative district code, e.g. DPG. */
  district: string
  /** A positive RESULTS opening opens its access study; otherwise the FTEN key starts a design. */
  openingId?: string
  cutblockSKey?: string
  /** Reported harvest start and completion, or the planned harvest date for a planned block. */
  harvest: string
  /** DEM flights the index listed, and when they fall against the harvest. */
  lidar: string
}

export const LIDAR_TEST_BLOCKS_SCREENED = '2026-11-17'

export const LIDAR_TEST_CATEGORIES: Record<LidarTestCategory, { title: string; use: string }> = {
  planned: {
    title: 'Planned, LiDAR flown before harvest',
    use: 'Design access on LiDAR ground that predates the road. Confirm in imagery that no road was cut before the flight.',
  },
  'before-after': {
    title: 'Harvested between two LiDAR flights',
    use: 'Compare the ground before and after: the difference measures what the road and harvest moved. The road can predate the earlier flight; the difference shows whether it did.',
  },
  'as-built': {
    title: 'Built road, LiDAR flown after',
    use: 'Check a design or generated road against the road that was built, which the later LiDAR shows.',
  },
}

const planned = (
  cutblockSKey: string,
  licence: string,
  cuttingPermit: string | undefined,
  block: string,
  district: string,
  harvest: string,
  lidar: string,
): LidarTestBlock => ({
  id: `planned-${cutblockSKey}`,
  category: 'planned',
  licence,
  ...(cuttingPermit ? { cuttingPermit } : {}),
  block,
  district,
  cutblockSKey,
  harvest: `planned ${harvest}`,
  lidar,
})

const opening = (
  category: 'before-after' | 'as-built',
  openingId: string,
  licence: string,
  cuttingPermit: string | undefined,
  block: string,
  district: string,
  harvest: string,
  lidar: string,
): LidarTestBlock => ({
  id: `${category}-${openingId}`,
  category,
  licence,
  ...(cuttingPermit ? { cuttingPermit } : {}),
  block,
  district,
  openingId,
  harvest,
  lidar,
})

export const LIDAR_TEST_BLOCKS: readonly LidarTestBlock[] = [
  planned('871904', 'A18163', 'T01', 'LCT001', 'DPG', '2027-01-01', 'DEM and point cloud flown 2024-07-14'),
  planned('862513', 'TFL52', '14F', '28', 'DQU', '2026-01-19', 'DEM and point cloud flown 2024-07-13'),
  planned('870019', 'A93686', '034', 'TD104', 'DCC', '2026-10-11', 'DEM and point cloud flown 2024-05-10'),
  planned('871139', 'A94502', '032', 'R058', 'DVA', '2026-10-06', 'DEM and point cloud flown 2024-09-10'),
  planned('870590', 'A98730', 'R87', 'MPH523', 'DMK', '2026-10-31', 'DEM and point cloud flown 2025-06-22'),
  planned('861165', 'A98867', '200', '18', 'DSE', '2026-01-09', 'DEM and point cloud flown 2025-06-28'),
  planned('863177', 'TA2089', undefined, 'SK-002', 'DOS', '2026-05-01', 'DEM and point cloud flown 2024-07-28'),
  planned('871744', 'A99392', 'KL3', '141', 'DPC', '2026-10-30', 'DEM and point cloud flown 2024-08-31'),
  opening(
    'before-after',
    '1774994',
    'A85847',
    undefined,
    '2',
    'DPG',
    '2022-06-22 to 2022-08-08',
    'DEM 2020 (BCTS) before, 2024 after',
  ),
  opening(
    'before-after',
    '1744220',
    'A93684',
    'X3',
    '50',
    'DQU',
    '2020-09-30 to 2021-01-12',
    'DEM 2011 before, 2023 after',
  ),
  opening(
    'before-after',
    '1743403',
    'A20019',
    '686',
    'W0361',
    'DCC',
    '2020-08-28 to 2020-12-02',
    'DEM 2019 (VRI 100 Mile House) before, 2024 after',
  ),
  opening(
    'before-after',
    '1747626',
    'K5P',
    '6',
    '38',
    'DVA',
    '2021-01-04 to 2021-02-23',
    'DEM 2020 (BCTS) before, 2024 after',
  ),
  opening(
    'before-after',
    '1762095',
    'A20002',
    '559',
    '12',
    'DMH',
    '2021-03-01 to 2021-09-30',
    'DEM 2019 (VRI 100 Mile House) before, 2024 after',
  ),
  opening(
    'before-after',
    '1731758',
    'A20212',
    '212',
    'LMR0039',
    'DSE',
    '2019-12-05 to 2020-02-05',
    'DEM 2017 before, 2022 after',
  ),
  opening(
    'before-after',
    '1755463',
    'A19040',
    '694',
    'WER0024',
    'DRM',
    '2021-06-14 to 2021-07-05',
    'DEM 2016 before, 2022 after',
  ),
  opening(
    'before-after',
    '1744453',
    'A96038',
    '313',
    '313-05',
    'DKA',
    '2019-10-07 to 2019-11-22',
    'DEM 2018 (BCTS) before, 2024 after',
  ),
  opening('as-built', '1517792', 'A18165', '49K', '49K002', 'DVA', '2013-01-15 to 2013-02-15', 'DEM 2024, one tile'),
  opening('as-built', '1459011', 'A40873', 'W76', 'WEE302A', 'DPG', '2012-03-02 to 2012-03-20', 'DEM 2024, one tile'),
  opening('as-built', '1473350', 'A18157', '61G', '61G003', 'DVA', '2012-06-26 to 2012-07-17', 'DEM 2024, one tile'),
  opening('as-built', '1481999', 'A20015', '864', 'WJ0030', 'DCC', '2012-07-21 to 2012-08-20', 'DEM 2024, one tile'),
  opening('as-built', '1463857', 'A18171', '619', '128', 'DPG', '2012-03-02 to 2012-03-29', 'DEM 2025, one tile'),
  opening('as-built', '1557797', 'A18158', '153', '010', 'DPG', '2013-07-05 to 2013-08-22', 'DEM 2025, one tile'),
]
