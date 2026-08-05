export function generateName({
    input,
    prefix = '',
    separator = ' ',
    existingNames,
}: {
    input: string
    /** Prepended to `input`, e.g. "New" → "New Chat". Omit for no prefix. */
    prefix?: string
    /** Joins the prefix, the input, and the numeric suffix. */
    separator?: string
    existingNames: string[]
}) {
    const base = prefix.trim()
        ? prefix.trim() + separator + input.trim()
        : input.trim();

    if (!existingNames.includes(base)) {
        return base;
    }

    let suffix = 2;

    while (existingNames.includes(`${base}${separator}${suffix}`)) {
        suffix++;
    }

    return `${base}${separator}${suffix}`;
}
