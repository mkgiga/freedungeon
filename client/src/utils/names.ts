export function generateName({
    input,
    prefix = 'New',
    existingNames,
}: {
    input: string
    prefix?: string
    existingNames: string[]
}) {
    const name = prefix.trim() + ' ' + input.trim();
    
    if (!existingNames.includes(name)) {
        return name;
    }

    let suffix = 2;
    
    while (existingNames.includes(`${name} ${suffix}`)) {
        suffix++;
    }
    
    return `${name} ${suffix}`;
}