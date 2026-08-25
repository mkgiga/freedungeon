export function generateName({
    input,
    prefix = '',
    separator = ' ',
    existingNames,
}: {
    input: string
    prefix?: string
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
