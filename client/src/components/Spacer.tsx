const sizeMap: Record<SpacerSizes, number> = {
    xs: 2,
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 24,
};

type SpacerSizes = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
type SpacerProps = {
    size?: SpacerSizes | number;
    dir?: 'horizontal' | 'vertical';
};

export function Spacer({ size = 'md', dir = 'vertical' }: SpacerProps) {
    const sizeValue = typeof size === 'number' ? size : sizeMap[size];
    const style = dir === 'vertical'
        ? { height: `${sizeValue}px`, width: '100%' }
        : { width: `${sizeValue}px`, height: '100%' };
    return <div style={style} />;
}