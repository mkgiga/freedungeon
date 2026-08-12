/** Plain helper in its own file — proves relative imports work with no build step. */
export function roll(sides: number): number {
    return 1 + Math.floor(Math.random() * sides)
}
