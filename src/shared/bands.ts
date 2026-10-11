/** Band layout of the filterbank (kept separate so param definition files can import it without cycles). */
export const BAND_FREQS = [29, 61, 115, 218, 411, 777, 1500, 2800, 5200, 11000] as const;
export const NUM_BANDS = BAND_FREQS.length;
