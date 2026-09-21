/** Fewer attempts = more points; 1/6 is nearly pure luck so it's a jackpot; failing costs points. */
export const POINTS: Record<number, number> = { 1: 50, 2: 20, 3: 10, 4: 6, 5: 4, 6: 2 };
export const FAIL_PENALTY = -3;

export const pointsFor = (attempts: number | null): number => (attempts === null ? FAIL_PENALTY : POINTS[attempts]);
